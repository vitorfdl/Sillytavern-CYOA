import {
    extension_settings,
    getContext,
  } from "../../../extensions.js";

import { saveSettingsDebounced,
    event_types,
    eventSource,
    setEditedMessageId,
    generateQuietPrompt,
    substituteParamsExtended,
 } from "../../../../script.js";

 import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
 import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
 import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
 import { MacrosParser } from '../../../macros.js';

const extensionName = "SillyTavern-CYOA-Responses";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {
    enabled: false,
    llm_prompt: `PAUSE THE ROLEPLAY.
The assistant will end the response with {{suggestionNumber}} distinct single-sentence suggestions for the next story beat, each suggestion surrounded by \`<suggestion>\` tags:
<suggestion>suggestion_1</suggestion>
<suggestion>suggestion_2</suggestion>
...`,
    llm_prompt_impersonate: `[Narrate for {{user}}: {{suggestionText}}]
[Write User response]`,
    apply_wi_an: false,
    num_responses: 3,
};
let inApiCall = false;

/**
 * Parses the CYOA response and returns the suggestions buttons
 * @param {string} response
 * @returns {string} text
 */
function parseResponse(response) {
    const suggestions = [];
    const regex = /<\s*suggestion\s*>(.+?)<\s*\/\s*suggestion\s*>|Suggestion\s+\d+\s*:\s*(.+)|Suggestion_\d+\s*:\s*(.+)/gi;
    let match;

    while ((match = regex.exec(response)) !== null) {
        suggestions.push(match[1] || match[2]);
    }

    if (suggestions.length === 0) {
        return;
    }

    const newResponse = suggestions.map((suggestion, index) =>
        `<div class="suggestion">
            <button class="suggestion" data-index="${index}">${suggestion}</button>
            <button class="edit fa-solid fa-pen-to-square" data-index="${index}">
                <span class="text">${suggestion}</span>
            </button>
        </div>`);
    return `<div class=\"suggestions\">${newResponse.join("\n")}</div>`;
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

    toastr.info('CYOA: Generating response...');
    const prompt = extension_settings.cyoa_responses?.llm_prompt || defaultSettings.llm_prompt || "";
    const response = await generateQuietPrompt(prompt, true, true, null, null, 350);
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
    if (lastMessage?.extra && lastMessage?.extra?.model === 'cyoa') {
        const target = $('#chat').find(`.mes[mesid=${lastMessage.mesId}]`);
        if (target.length > 0) {
            setEditedMessageId(lastMessage.mesId);
            target.find('.mes_edit_delete').trigger('click', { fromSlashCommand: true });
        }
    }
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
        mes: parsedResponse,
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
    const text = $button.text().trim();

    removeLastCYOAMessage();
    // Sleep for 500ms before continuing
    await new Promise(resolve => setTimeout(resolve, 500));

    const inputTextarea = document.querySelector('#send_textarea');
    if (inputTextarea instanceof HTMLTextAreaElement) {
        let impersonatePrompt = extension_settings.cyoa_responses?.llm_prompt_impersonate || '';
        impersonatePrompt = substituteParamsExtended(String(extension_settings.cyoa_responses?.llm_prompt_impersonate), { suggestionText: text });
        const quiet_prompt = `/impersonate await=true ${impersonatePrompt}`;
        inputTextarea.value = quiet_prompt;
        inputTextarea.dispatchEvent(new Event('input', { bubbles: true }));

            // Find and click the send button
        const sendButton = document.querySelector('#send_but');
        if (sendButton instanceof HTMLElement) {
            sendButton.click();
        }
    }
}

/**
 * Handles the CYOA by sending the text to the User Input box
 * @param {*} event
 */
function handleCYOAEditBtn(event) {
    const $button = $(event.target);
    const text = $button.find('.text').text().trim();
    if (text.length === 0) {
        return;
    }

    removeLastCYOAMessage();
    const inputTextarea = document.querySelector('#send_textarea');
    if (inputTextarea instanceof HTMLTextAreaElement) {
        inputTextarea.value = text;
    }
}


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
    $('#cyoa_num_responses_value').text(extension_settings.cyoa_responses.num_responses).trigger('input');
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
    $(document).on('click', '.custom-suggestion', handleCYOABtn);
    $(document).on('click', '.custom-edit', handleCYOAEditBtn);
});