import { is_group_generating, selected_group } from '../../../../group-chats.js';
import {
    characters,
    saveSettingsDebounced,
    getThumbnailUrl,
    substituteParamsExtended,
    main_api,
    system_message_types,
} from "../../../../../script.js";

import { power_user }  from '../../../../power-user.js';
import { formatInstructModeChat, formatInstructModePrompt } from '../../../../instruct-mode.js';
import {
    extension_settings,
    getContext,
 } from "../../../../extensions.js";

import {
    collapseNewlines
} from "../../../../power-user.js";

import { getRegexedString } from '../../../regex/engine.js';

/**
 * Normalizes the chat prompt for language model input.
 * @param {Object} params - The parameters for normalizing the chat prompt.
 * @param {Object} params.prompt - The prompt configuration.
 * @param {string} params.prompt.text - The text to use for the prompt.
 * @param {('suffix'|'prefix'|'in-depth')} params.prompt.position - The position of the prompt.
 * @param {number} [params.prompt.inDepthNumber] - The in-depth number value (required if position is 'in-depth').
 * @param {string} [params.prompt.name='System'] - The name to use for the prompt.
 * @param {number} [params.prompt.sendas=0] - 0 for system, 1 for user, 2 for character
 * @param {Array} [params.chatHistory] - Optional chat history to use instead of automatic context retrieval.
 * @param {boolean} [params.noNameOnAssistantSuffix] - set to true to not add the `{{name}}: ` to the assistant suffix
 * @param {boolean} [params.includeWiAn] - Whether to include world info and author notes.
 * @returns {Promise<string>} The normalized chat prompt for prompt-chatcompletion.js or prompt-textcompletion.js.
 */
export async function normalizeChatPrompt(params) {
    const context = getContext();
    const chat = params.chatHistory || context.chat;

    // Collect messages with usable content
    let coreChat = chat.filter(x => !x.is_system);

    coreChat = await Promise.all(coreChat.map(async (chatItem, index) => {
        let message = chatItem.mes;
        let regexType = chatItem.is_user ? 'USER_INPUT' : 'AI_OUTPUT';
        let options = { isPrompt: true, depth: (coreChat.length - index - 1) };

        let regexedMessage = getRegexedString(message, regexType, options);
        // Note: appendFileContent function is not provided, so it's omitted here
        // regexedMessage = await appendFileContent(chatItem, regexedMessage);

        if (chatItem?.extra?.append_title && chatItem?.extra?.title) {
            regexedMessage = `${regexedMessage}\n\n${chatItem.extra.title}`;
        }

        return {
            ...chatItem,
            mes: regexedMessage,
            index,
        };
    }));

    // Inject all Depth prompts
    // let injectedIndices = [];
    // if (main_api !== 'openai') {
    //     injectedIndices = doChatInject(coreChat); // ? doChatInject is not exported =[
    // }

    // Format messages
    let formattedChat = [];
    for (let i = coreChat.length - 1; i >= 0; i--) {
        const isInstruct = power_user.instruct.enabled && main_api !== 'openai';
        formattedChat[i] = formatMessageHistoryItem(coreChat[i], isInstruct, context, false);

        if (i === 0 && isInstruct) {
            // Reformat with the first output sequence (if any)
            formattedChat[i] = formatMessageHistoryItem(coreChat[i], isInstruct, context, 'FIRST');
        }

        if (i === coreChat.length - 1 && isInstruct) {
            // Reformat with the last input sequence (if any)
            formattedChat[i] = formatMessageHistoryItem(coreChat[i], isInstruct, context, 'LAST');
        }
    }

    // Inject prompt based on position
    const injectPrompt = () => {
        const promptText = substituteParamsExtended(params.prompt.text);
        const promptName = params.prompt.name || 'System';
        // let promptMessage = { name: promptName, mes: promptText, is_system: true };

        if (power_user.instruct.enabled && main_api !== 'openai') {
            return formatInstructModeChat(promptName, promptText, params.prompt.sendas === 1, !params.prompt.sendas, false, context.name1, context.name2);
        } else {
            return `${promptName}: ${promptText}\n`;
        }
    };

    let combinedPrompt = '';

    if (params.prompt.position === 'prefix') {
        combinedPrompt += injectPrompt();
    }

    // Combine the formatted chat
    combinedPrompt += formattedChat.join('');

    if (params.prompt.position === 'suffix') {
        combinedPrompt += injectPrompt();
    } else if (params.prompt.position === 'in-depth') {
        const inDepthIndex = coreChat.length - 1 - params.prompt.inDepthNumber;
        if (inDepthIndex >= 0 && inDepthIndex < formattedChat.length) {
            const parts = formattedChat.slice(0, inDepthIndex);
            parts.push(injectPrompt());
            parts.push(...formattedChat.slice(inDepthIndex));
            combinedPrompt = parts.join('');
        }
    }

    if (power_user.collapse_newlines) {
        combinedPrompt = collapseNewlines(combinedPrompt);
    }

    // Add any additional processing here (e.g., adding world info, author's note, etc.)
    if (params.includeWiAn) {
        // Add logic to include world info and author's note
    }

    // Attach the instruct for the assistant
    if (power_user.instruct.enabled && main_api !== 'openai') {
        const name = !params.noNameOnAssistantSuffix ? `${context.name2}:` : context.name2;
        const assistantInstruct = formatInstructModePrompt(name, false);
        combinedPrompt += assistantInstruct;
    } else {
        combinedPrompt += !params.noNameOnAssistantSuffix ? `${context.name2}:` : ``;
    }

    console.log(combinedPrompt);

    return combinedPrompt;
}

/**
 * Copy from SillyTavern script.js (not exported)
 * @param {Object} chatItem Message history item.
 * @param {boolean} isInstruct Whether instruct mode is enabled.
 * @param {Object} context Context object.
 * @param {boolean|number} forceOutputSequence Whether to force the first/last output sequence for instruct mode.
 */
function formatMessageHistoryItem(chatItem, isInstruct, context, forceOutputSequence) {
    const isNarratorType = chatItem?.extra?.type === system_message_types.NARRATOR;
    const characterName = chatItem?.name ? chatItem.name : name2;
    const itemName = chatItem.is_user ? chatItem['name'] : characterName;
    const shouldPrependName = !isNarratorType;

    // Don't include a name if it's empty
    let textResult = chatItem?.name && shouldPrependName ? `${itemName}: ${chatItem.mes}\n` : `${chatItem.mes}\n`;

    if (isInstruct) {
        textResult = formatInstructModeChat(itemName, chatItem.mes, chatItem.is_user, isNarratorType, chatItem.force_avatar, context.name1, context.name2, forceOutputSequence);
    }

    return textResult;
}
