import {
    extension_settings,
    getContext,
  } from "../../../extensions.js";

import { saveSettingsDebounced,
    setEditedMessageId,
    generateQuietPrompt,
    is_send_press,
    substituteParamsExtended,
 } from "../../../../script.js";

 import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
 import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
 import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
 import { MacrosParser } from '../../../macros.js';
 import { is_group_generating, selected_group } from '../../../group-chats.js';

const extensionName = "Sillytavern-CYOA";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {
    enabled: false,
    llm_prompt: `Stop the roleplay now and provide a response with {{suggestionNumber}} brief distinct single-sentence suggestions for the next story beat on {{user}} perspective. Ensure each suggestion aligns with its corresponding description:
1. Eases tension and improves the protagonist's situation
2. Creates or increases tension and worsens the protagonist's situation
3. Leads directly but believably to a wild twist or super weird event
4. Slowly moves the story forward without ending the current scene
5. Pushes the story forward, potentially ending the current scene if feasible

Each suggestion surrounded by \`<suggestion>\` tags. E.g:
<suggestion>suggestion_1</suggestion>
<suggestion>suggestion_2</suggestion>
...

Do not include any other content in your response.`,
    llm_prompt_impersonate: `[Event Direction for the next story beat on {{user}} perspective: \`{{suggestionText}}\`]
[Based on the expected events, write the user response]`,
    apply_wi_an: true,
    num_responses: 5,
    response_length: 500,
};
let inApiCall = false;

/**
 * Parses the CYOA response and returns the suggestions buttons
 * @param {string} response
 * @returns {string} text
 */
function parseResponse(response) {
    const suggestions = [];
    const regex = /<suggestion>(.+?)<\/suggestion>|Suggestion\s+\d+\s*:\s*(.+)|Suggestion_\d+\s*:\s*(.+)|^\d+\.\s*(.+)/gim;
    let match;

    while ((match = regex.exec(`${response}\n`)) !== null) {
        const suggestion = match[1] || match[2] || match[3] || match[4];
        if (suggestion && suggestion.trim()) {
            suggestions.push(suggestion.trim());
        }
    }

    if (suggestions.length === 0) {
        return;
    }

    const newResponse = suggestions.map((suggestion) =>
`<div class="suggestion"><button class="suggestion">${suggestion}</button><button class="edit-suggestion fa-solid fa-pen-to-square"><span class="text">${suggestion}</span></button></div>`);
    return `<div class=\"suggestions\">${newResponse.join("")}</div>`
}

async function waitForGeneration() {
    try {
        // Wait for group to finish generating
        if (selected_group) {
            await waitUntilCondition(() => is_group_generating === false, 1000, 10);
        }
        // Wait for the send button to be released
        waitUntilCondition(() => is_send_press === false, 30000, 100);
    } catch {
        console.debug('Timeout waiting for is_send_press');
        return;
    }
}
/**
 * Handles the CYOA response generation
 * @returns
 */
async function requestCYOAResponses() {
    const context = getContext();
    const chat = context.chat;

    // no characters or group selected
    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    // Currently summarizing or frozen state - skip
    if (inApiCall) {
        return;
    }

    // No new messages - do nothing
    // if (chat.length === 0 || (lastMessageId === chat.length && getStringHash(chat[chat.length - 1].mes) === lastMessageHash)) {
    if (chat.length === 0) {
        return;
    }

    removeLastCYOAMessage(chat);

    await waitForGeneration();

    toastr.info('CYOA: Generating response...');
    const prompt = extension_settings.cyoa_responses?.llm_prompt || defaultSettings.llm_prompt || "";
    const useWIAN = extension_settings.cyoa_responses?.apply_wi_an || defaultSettings.apply_wi_an;
    const responseLength = extension_settings.cyoa_responses?.response_length || defaultSettings.response_length;
    //  generateQuietPrompt(quiet_prompt, quietToLoud, skipWIAN, quietImage = null, quietName = null, responseLength = null, noContext = false)
    const response = await generateQuietPrompt(prompt, false, !useWIAN, null, "Suggestion List", responseLength);

    const parsedResponse = parseResponse(response);
    if (!parsedResponse) {
        toastr.error('CYOA: Failed to parse response');
        return;
    }

    await sendMessageToUI(parsedResponse);
}

/**
 * Removes the last CYOA message from the chat
 * @param {getContext.chat} chat
 */
function removeLastCYOAMessage(chat = getContext().chat) {
    let lastMessage = chat[chat.length - 1];
    if (!lastMessage?.extra || lastMessage?.extra?.model !== 'cyoa') {
        return;
    }

    const target = $('#chat').find(`.mes[mesid=${lastMessage.mesId}]`);
    if (target.length === 0) {
        return;
    }

    setEditedMessageId(lastMessage.mesId);
    target.find('.mes_edit_delete').trigger('click', { fromSlashCommand: true });
}

/**
 * Sends the parsed CYOA response to the SillyTavern UI
 * @param {string} parsedResponse
 */
async function sendMessageToUI(parsedResponse) {
    const context = getContext();
    const chat = context.chat;

    const messageObject = {
        name: "CYAO Options",
        is_user: true,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: `${parsedResponse}`,
        mesId: context.chat.length,
        extra: {
            api: 'manual',
            model: 'cyoa',
        }
    };

    context.chat.push(messageObject);
    // await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
    context.addOneMessage(messageObject, { showSwipes: false, forceId: chat.length - 1 });
}

/**
 * Handles the CYOA click event by doing impersonation
 * @param {*} event
 */
async function handleCYOABtn(event) {
    const $button = $(event.target);
    const text = $button?.text()?.trim() || $button.find('.custom-text')?.text()?.trim();
    if (text.length === 0) {
        return;
    }
    await waitForGeneration();

    removeLastCYOAMessage();
    // Sleep for 500ms before continuing
    await new Promise(resolve => setTimeout(resolve, 250));

    const inputTextarea = document.querySelector('#send_textarea');
    if (!(inputTextarea instanceof HTMLTextAreaElement)) {
        return;
    }

    let impersonatePrompt = extension_settings.cyoa_responses?.llm_prompt_impersonate || '';
    impersonatePrompt = substituteParamsExtended(String(extension_settings.cyoa_responses?.llm_prompt_impersonate), { suggestionText: text });

    const quiet_prompt = `/impersonate await=true ${impersonatePrompt}`;
    inputTextarea.value = quiet_prompt;

    if ($button.hasClass('custom-edit-suggestion')) {
        return; // Stop here if it's the edit button
    }

    inputTextarea.dispatchEvent(new Event('input', { bubbles: true }));

    const sendButton = document.querySelector('#send_but');
    if (sendButton instanceof HTMLElement) {
        sendButton.click();
    }
}

/**
 * Handles the CYOA by sending the text to the User Input box
 * @param {*} event
 */
// function handleCYOAEditBtn(event) {
//     const $button = $(event.target);
//     const text = $button.find('.custom-text').text().trim();
//     if (text.length === 0) {
//         return;
//     }

//     removeLastCYOAMessage();
//     const inputTextarea = document.querySelector('#send_textarea');
//     if (inputTextarea instanceof HTMLTextAreaElement) {
//         inputTextarea.value = text;
//     }
// }


/**
 * Settings Stuff
 */
function loadSettings() {
  extension_settings.cyoa_responses = extension_settings.cyoa_responses || {};
    if (Object.keys(extension_settings.cyoa_responses).length === 0) {
        extension_settings.cyoa_responses = {};
    }
    Object.assign(defaultSettings, extension_settings.cyoa_responses);

    $('#cyoa_llm_prompt').val(extension_settings.cyoa_responses.llm_prompt).trigger('input');
    $('#cyoa_llm_prompt_impersonate').val(extension_settings.cyoa_responses.llm_prompt_impersonate).trigger('input');
    $('#cyoa_apply_wi_an').prop('checked', extension_settings.cyoa_responses.apply_wi_an).trigger('input');
    $('#cyoa_num_responses').val(extension_settings.cyoa_responses.num_responses).trigger('input');
    $('#cyoa_num_responses_value').text(extension_settings.cyoa_responses.num_responses);
    $('#cyoa_response_length').val(extension_settings.cyoa_responses.response_length).trigger('input');
    $('#cyoa_response_length_value').text(extension_settings.cyoa_responses.response_length);

}

function addEventListeners() {
    $('#cyoa_llm_prompt').on('input', function() {
        extension_settings.cyoa_responses.llm_prompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#cyoa_llm_prompt_impersonate').on('input', function() {
        extension_settings.cyoa_responses.llm_prompt_impersonate = $(this).val();
        saveSettingsDebounced();
    });

    $('#cyoa_apply_wi_an').on('change', function() {
        extension_settings.cyoa_responses.apply_wi_an = !!$(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#cyoa_num_responses').on('input', function() {
        const value = $(this).val();
        extension_settings.cyoa_responses.num_responses = Number(value);
        $('#cyoa_num_responses_value').text(value);
        saveSettingsDebounced();
    });

    $('#cyoa_response_length').on('input', function() {
        const value = $(this).val();
        extension_settings.cyoa_responses.response_length = Number(value);
        $('#cyoa_response_length_value').text(value);
        saveSettingsDebounced();
    });
}

// This function is called when the extension is loaded
jQuery(async () => {
    //add a delay to possibly fix some conflicts
    await new Promise(resolve => setTimeout(resolve, 900));
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);
    loadSettings();
    addEventListeners();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoa',
        callback: async () => {
            await requestCYOAResponses();
            return '';
        },
        helpString: 'Triggers CYOA responses generation.',
    }));

    MacrosParser.registerMacro('suggestionNumber', () => `${extension_settings.cyoa_responses?.num_responses || defaultSettings.num_responses}`);

    // Event delegation for CYOA buttons
    $(document).on('click', 'button.custom-edit-suggestion', handleCYOABtn);
    $(document).on('click', 'button.custom-suggestion', handleCYOABtn);
});
