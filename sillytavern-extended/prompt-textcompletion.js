/**
 * SillyTavern Extended - Prompt Text Completion Module
 *
 * This module provides functionality for prompting language models
 * and handling text completion responses in SillyTavern.
 *
 * It supports different APIs and streaming options for flexible
 * text generation capabilities.
 *
 * @author @vitorfdl
 * @version 1.0
 */

import { getTextGenGenerationData, generateTextGenWithStreaming } from "../../../../textgen-settings.js";
import { getNovelGenerationData, generateNovelWithStreaming } from "../../../../nai-settings.js";
import {
    main_api,
    novelai_settings,
    novelai_setting_names,
    nai_settings,
    getRequestHeaders,
    messageFormatting
} from "../../../../../script.js";
import {
    getContext,
 } from "../../../../extensions.js";

/**
 * Prompts the language model with the given parameters.
 * @param {Object} params - The parameters for the prompt.
 * @param {string} params.prompt - The prompt text to send to the language model. You may want to get chat history with chat-normalizer.js
 * @param {number} params.maxTokens - The maximum number of tokens to generate.
 * @param {boolean} [params.useStreaming=true] - Whether to use streaming for the response. Mes is required if useStreaming is true.
 * @param {Object} [params.mes] - The message object to be used for the prompt (if you want to see streaming progress in the UI).
 * @param {HTMLElement} params.mes.mesDiv - The message div element.
 * @param {string} params.mes.mesId - The message ID.
 * @param {string} [params.mes.swipeId] - The optional swipe ID.
 * @returns {Promise<string|AsyncGenerator<string, void, unknown>>} The generated text or a streaming generator.
 */
export async function promptLLM(params) {
    const { prompt, useStreaming = true, mes } = params;
    let { maxTokens } = params || { maxTokens: power_user.max_context };
    let generateData;

    // Prepare generation data based on the current API
    switch (main_api) {
        case 'novel':
            const novelSettings = novelai_settings[novelai_setting_names[nai_settings.preset_settings_novel]];
            generateData = getNovelGenerationData(prompt, novelSettings, maxTokens, false, false, null, 'quiet');
            break;
        case 'textgenerationwebui':
            generateData = getTextGenGenerationData(prompt, maxTokens, false, false, null, 'quiet');
            break;
        default:
            throw new Error('Unsupported API:', main_api);
    }

    // Trigger the generation
    const abortController = new AbortController();
    const mesDiv = document.querySelector(`[mesid="${params.mes?.mesId || "UNDEFINED"}"]`);

    if (useStreaming && mesDiv) {
        abortController.signal.mesDiv = mesDiv;
        abortController.signal.mesId = params.mes.mesId;
        abortController.signal.swipeId = params.mes.swipeId;
        return streamingGeneration(generateData, abortController.signal);
    } else {
        return nonStreamingGeneration(generateData, abortController.signal);
    }
}

async function streamingGeneration(generateData, signal) {
    const context = getContext();
    const { mesId } = signal;
    const mesDiv = document.querySelector(`[mesid="${mesId}"] .mes_text`);
    if (!mesDiv) {
        throw new Error('Could not find mesDiv for mesId: ' + mesId);
    }

    let res;
    switch (main_api) {
        case 'textgenerationwebui':
            res = await generateTextGenWithStreaming(generateData, signal);
            break;
        case 'novel':
            res = await generateNovelWithStreaming(generateData, signal);
            break;
        default:
            throw new Error('Streaming is enabled, but the current API does not support streaming.');
    }

    let fullText = '';
    for await (const chunk of res()) {
        fullText += chunk.text;
        mesDiv.innerHTML = messageFormatting(
            chunk.text,
            context.name2,
            context.chat[mesId].isSystem,
            context.chat[mesId].isUser,
            mesId
        );
    }
    context.chat[mesId].mes = fullText;
    context.saveChat();
}

async function nonStreamingGeneration(generateData, signal) {
    const response = await fetch(getGenerateUrl(main_api), {
        method: 'POST',
        headers: getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify(generateData),
        signal: signal,
    });

    if (!response.ok) {
        const error = await response.json();
        throw error;
    }

    const res = await response.json();
    return main_api === 'novel' ? res.output : res?.choices?.[0]?.message?.content ?? res?.choices?.[0]?.text ?? res?.text ?? '';
}

function getGenerateUrl(api) {
    switch (api) {
        case 'kobold':
            return '/api/backends/kobold/generate';
        case 'koboldhorde':
            return '/api/backends/koboldhorde/generate';
        case 'textgenerationwebui':
            return '/api/backends/text-completions/generate';
        case 'novel':
            return '/api/novelai/generate';
        default:
            throw new Error(`Unknown API: ${api}`);
    }
}
