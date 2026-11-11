/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { IconComponent, OptionType, PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Message } from "@vencord/discord-types";
import { AuthenticationStore, ChannelStore, GuildStore, Menu, Modal, openModal, SearchableSelect, showToast, TextInput, useEffect, useState } from "@webpack/common";
import TinySegmenter from "tiny-segmenter";

import { translate } from "@plugins/translate/utils";

const Native = VencordNative.pluginHelpers.YomiCord as PluginNative<typeof import("./native")>;

const SINGLE_KANJI_REGEX = /^[\p{Script=Han}]$/u;
const segmenter = new TinySegmenter();
const PUNCTUATION_REGEX = /^[、。！？!?…,.]+$/u;
const SYMBOL_ONLY_REGEX = /^[\p{P}\p{S}]+$/u;
const UI_NOISE_LINE_REGEX = /(Click to react|Add Reaction|Reply|Forward|More|[0-9]{1,2}:[0-9]{2}|Tuesday|Monday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
const INFLECTION_ENDINGS = new Set([
    "る",
    "た",
    "て",
    "ない",
    "ます",
    "たい",
    "だった",
    "だ",
    "です",
    "でした",
    "ちゃった",
    "じゃった"
]);

const MULTI_TOKEN_COMPOUNDS = new Set([
    "たくさん",
    "みなさん",
    "たぶん",
    "すこし",
    "すこしも"
]);

const COMMON_GRAMMAR_GLOSSES: Record<string, string> = {
    "は": "topic marker",
    "が": "subject marker",
    "を": "object marker",
    "に": "to / at / in",
    "へ": "toward / to",
    "で": "te-form connector / location / instrument marker",
    "と": "and / with / quote marker",
    "も": "also / too",
    "の": "of / possession / nominalizer",
    "ね": "sentence-ending particle (seeking agreement)",
    "よ": "sentence-ending particle (emphasis)",
    "な": "sentence-ending particle / prohibition marker (context)",
    "ぞ": "strong emphatic ending (masculine/casual)",
    "さ": "casual sentence-ending emphasis",
    "わ": "sentence-ending softening particle",
    "か": "question marker",
    "だ": "copula (plain 'is')",
    "です": "polite copula",
    "でした": "polite past copula",
    "ます": "polite verb ending",
    "ました": "polite past ending",
    "ません": "polite negative ending",
    "たい": "want to do",
    "たくない": "do not want to do",
    "ない": "negative form",
    "なかった": "past negative form",
    "て": "te-form connector",
    "た": "past tense marker",
    "ば": "conditional ('if ...')",
    "たら": "conditional ('if/when ...')",
    "なら": "if it is / if so",
    "とき": "when",
    "から": "because / from",
    "ので": "because (softer than から)",
    "のに": "although / despite",
    "けど": "but / though",
    "けれど": "but / although",
    "ても": "even if",
    "でも": "but / however / even",
    "だけ": "only / just",
    "しか": "only (with negative)",
    "ほど": "to the extent / about",
    "くらい": "about / approximately",
    "ぐらい": "about / approximately",
    "まで": "until / up to",
    "より": "than / from",
    "や": "and (non-exhaustive listing)",
    "ながら": "while doing",
    "しながら": "while doing",
    "ように": "so that / in order to / like",
    "ために": "for the purpose of / for",
    "つもり": "intention / plan to",
    "こと": "nominalizer / abstract thing",
    "もの": "thing / explanatory tone (context)",
    "ん": "contracted の (explanatory)",
    "でしょう": "probably / polite conjecture",
    "だろう": "probably / plain conjecture",
    "かも": "might / maybe",
    "かな": "I wonder / maybe",
    "ちゃう": "casual contraction of てしまう",
    "じゃう": "casual contraction of でしまう",
    "ちゃった": "casual contraction of てしまった (often 'oops' or regret nuance)",
    "じゃった": "casual contraction of でしまった (often 'oops' or regret nuance)",
    "なきゃ": "must do (casual contraction of なければ)",
    "なくちゃ": "must do (casual)",
    "なくて": "not and / not doing and",
    "じゃない": "is not / not",
    "ではない": "is not (formal/plain)",
    "では": "then / well then / as for",
    "って": "quoting/topic marker (casual)",
    "し": "do (verb stem of する)",
    "する": "to do",
    "して": "do (from する = to do; te-form)",
    "できる": "can do / be able to",
    "られる": "potential/passive ending (can be / be done)",
    "れる": "potential/passive ending",
    "させる": "causative ending (make/let someone do)",
    "させられる": "causative-passive (be made to do)",
    "よう": "seems like / volitional marker (context)",
    "そう": "seems / looks like / heard that (context)",
    "らしい": "apparently / typical of",
    "べき": "should / ought to",
    "はず": "should be expected to",
    "ことがある": "there are times when / have done before",
    "ことにする": "decide to do",
    "ことになる": "it is decided that / come to be"
};

const CONJUGATION_OVERRIDES: Record<string, { dictionary: string; form: string; meaning: string; }> = {
    "行って": { dictionary: "行く", form: "te-form", meaning: "go (and ...)" }
};

interface ClauseBreakdown {
    source: string;
    translation: string;
    tokens: string[];
    glosses: Array<{ surface: string; gloss: string; }>;
}

interface KanjiContextEntry {
    kanji: string;
    words: string[];
}

interface GrammarPointEntry {
    surface: string;
    point: string;
    explanation: string;
    source: string;
    translation: string;
}

type AnkiCardType = "term" | "grammar" | "kanji" | "sentence";

interface AnkiTemplateData {
    type: AnkiCardType;
    expression: string;
    meaning: string;
    reading: string;
    kunyomi: string;
    onyomi: string;
    keywords: string;
    strokes: string;
    grade: string;
    jlpt: string;
    sentence: string;
    translation: string;
    audio: string;
    image: string;
}

const BASE_CHIP_STYLE = {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--border-subtle)",
    background: "var(--background-tertiary)",
    fontSize: 12,
    color: "var(--text-normal)",
    lineHeight: 1.35,
    cursor: "pointer"
} as const;

const SECTION_TAB_STYLE = {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--border-subtle)",
    background: "var(--background-tertiary)",
    color: "var(--text-normal)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer"
} as const;

function formatGrammarNoteMeaning(entry: GrammarPointEntry) {
    const point = entry.point.trim();
    const explanation = entry.explanation.trim();
    if (point && explanation) return `${point}: ${explanation}`;
    return point || explanation || "grammar point";
}

const tokenGlossCache = new Map<string, string>();
const jishoMeaningCache = new Map<string, string>();
const jishoReadingCache = new Map<string, string>();
const kanjiInfoCache = new Map<string, {
    kunyomi: string;
    onyomi: string;
    keywords: string;
    strokes: string;
    grade: string;
    jlpt: string;
}>();
let lastClipboardImageFingerprint = "";
const ANKI_CONNECT_URL_DEFAULT = "http://127.0.0.1:8765";
const ANKI_MODEL_DEFAULT = "Basic";
const ANKI_TERM_DECK = "YomiCord::Words";
const ANKI_KANJI_DECK = "YomiCord::Kanji";
const ANKI_GRAMMAR_DECK = "YomiCord::Grammar";
const ANKI_SENTENCE_DECK = "YomiCord::Sentences";
const ANKI_CORS_ORIGINS_TEMPLATE = [
    "[",
    "  \"http://localhost\",",
    "  \"https://discord.com\",",
    "  \"https://ptb.discord.com\",",
    "  \"https://canary.discord.com\"",
    "]"
].join("\n");
const WORD_TOKEN_HELP_TEXT = "Word tokens: {expression}, {glossary}, {furigana}, {sentence}, {translation}, {audio}, {image}";
const KANJI_TOKEN_HELP_TEXT = "Kanji tokens: {expression}, {glossary}, {reading}, {kunyomi}, {onyomi}, {keywords}, {strokes}, {grade}, {jlpt}, {sentence}, {translation}, {image}";
const ANKI_FIELD_MAP_DEFAULT = [
    "Vocab (Front): {expression}",
    "Meaning (Back): {glossary}",
    "Reading: {furigana}",
    "Source Sentence: {sentence}",
    "Translation: {translation}",
    "Audio: {audio}",
    "Image: {image}"
].join("\n");

function AnkiDeckModelPicker() {
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState("Not loaded yet.");
    const [activeTab, setActiveTab] = useState<"setup" | AnkiCardType>("setup");
    const [decks, setDecks] = useState<string[]>([]);
    const [models, setModels] = useState<string[]>([]);

    const values = settings.use([
        "autoAttachImage",
        "ankiConnectUrl",
        "ankiWordDeck",
        "ankiGrammarDeck",
        "ankiKanjiDeck",
        "ankiSentenceDeck",
        "ankiWordModelName",
        "ankiGrammarModelName",
        "ankiKanjiModelName",
        "ankiSentenceModelName",
        "ankiWordFieldMap",
        "ankiGrammarFieldMap",
        "ankiKanjiFieldMap",
        "ankiSentenceFieldMap"
    ]);

    const typeMeta: Record<"setup" | AnkiCardType, { label: string; }> = {
        setup: { label: "Setup" },
        term: { label: "Words" },
        grammar: { label: "Grammar" },
        kanji: { label: "Kanji" },
        sentence: { label: "Sentences" }
    };

    const tabs: Array<"setup" | AnkiCardType> = ["setup", "term", "grammar", "kanji", "sentence"];

    const withCurrentOption = (items: string[], current: string) => {
        const base = items.map(item => ({ label: item, value: item }));
        if (current && !items.includes(current)) {
            return [{ label: `${current} (custom)`, value: current }, ...base];
        }
        return base;
    };

    const refreshLists = async () => {
        setIsLoading(true);
        setStatus("Loading decks and note types from Anki...");

        try {
            const [deckNames, modelNames] = await Promise.all([
                callAnkiConnect<string[]>("deckNames"),
                callAnkiConnect<string[]>("modelNames")
            ]);

            const sortedDecks = [...deckNames].sort((a, b) => a.localeCompare(b));
            const sortedModels = [...modelNames].sort((a, b) => a.localeCompare(b));

            setDecks(sortedDecks);
            setModels(sortedModels);
            setStatus(`Connected. Found ${sortedDecks.length} decks and ${sortedModels.length} note types.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Unable to reach AnkiConnect: ${message}`);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void refreshLists();
    }, []);

    const getDeckValue = (type: AnkiCardType) => {
        if (type === "term") return values.ankiWordDeck;
        if (type === "grammar") return values.ankiGrammarDeck;
        if (type === "kanji") return values.ankiKanjiDeck;
        return values.ankiSentenceDeck;
    };

    const setDeckValue = (type: AnkiCardType, value: string) => {
        if (type === "term") settings.store.ankiWordDeck = value;
        else if (type === "grammar") settings.store.ankiGrammarDeck = value;
        else if (type === "kanji") settings.store.ankiKanjiDeck = value;
        else settings.store.ankiSentenceDeck = value;
    };

    const getModelValue = (type: AnkiCardType) => {
        if (type === "term") return values.ankiWordModelName;
        if (type === "grammar") return values.ankiGrammarModelName;
        if (type === "kanji") return values.ankiKanjiModelName;
        return values.ankiSentenceModelName;
    };

    const setModelValue = (type: AnkiCardType, value: string) => {
        if (type === "term") settings.store.ankiWordModelName = value;
        else if (type === "grammar") settings.store.ankiGrammarModelName = value;
        else if (type === "kanji") settings.store.ankiKanjiModelName = value;
        else settings.store.ankiSentenceModelName = value;
    };

    const getFieldMapValue = (type: AnkiCardType) => {
        if (type === "term") return values.ankiWordFieldMap;
        if (type === "grammar") return values.ankiGrammarFieldMap;
        if (type === "kanji") return values.ankiKanjiFieldMap;
        return values.ankiSentenceFieldMap;
    };

    const setFieldMapValue = (type: AnkiCardType, value: string) => {
        if (type === "term") settings.store.ankiWordFieldMap = value;
        else if (type === "grammar") settings.store.ankiGrammarFieldMap = value;
        else if (type === "kanji") settings.store.ankiKanjiFieldMap = value;
        else settings.store.ankiSentenceFieldMap = value;
    };

    const activeType: AnkiCardType = activeTab === "setup" ? "term" : activeTab;
    const activeDeck = getDeckValue(activeType);
    const activeModel = getModelValue(activeType);
    const activeFieldMap = getFieldMapValue(activeType);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowX: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {tabs.map(type => (
                        <Button
                            key={type}
                            onClick={() => setActiveTab(type)}
                            variant={activeTab === type ? "primary" : "secondary"}
                            size="small"
                        >
                            {typeMeta[type].label}
                        </Button>
                    ))}
                </div>
                <Button onClick={() => void refreshLists()} disabled={isLoading} size="small">
                    {isLoading ? "Refreshing..." : "Refresh"}
                </Button>
            </div>
            <Paragraph style={{ fontSize: 11 }}>{status}</Paragraph>

            {activeTab === "setup" ? (
                <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <Heading tag="h4" style={{ margin: 0 }}>Setup</Heading>
                    <Paragraph>1. Install Anki and the AnkiConnect add-on.</Paragraph>
                    <Paragraph>2. Open Anki before using YomiCord.</Paragraph>
                    <Paragraph>3. Keep AnkiConnect URL as {ANKI_CONNECT_URL_DEFAULT} unless you changed it.</Paragraph>
                    <Paragraph>4. Click Refresh, then pick deck and note type for each card type tab.</Paragraph>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Heading tag="h5">Auto Attach Image</Heading>
                        <Button
                            size="small"
                            variant={values.autoAttachImage ? "primary" : "secondary"}
                            onClick={() => settings.store.autoAttachImage = !settings.store.autoAttachImage}
                            style={{ width: "fit-content" }}
                        >
                            {values.autoAttachImage ? "On" : "Off"}
                        </Button>
                        <Paragraph style={{ fontSize: 11 }}>
                            When on, YomiCord tries clipboard image first, then message image, and reuses that image for all adds in the same lookup.
                        </Paragraph>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Heading tag="h5">AnkiConnect URL</Heading>
                        <TextInput
                            value={values.ankiConnectUrl}
                            placeholder={ANKI_CONNECT_URL_DEFAULT}
                            onChange={(value: string) => settings.store.ankiConnectUrl = value}
                        />
                    </div>

                    <div style={{ borderTop: "1px solid var(--border-subtle)", opacity: 0.8 }} />
                    <Heading tag="h5" style={{ margin: 0 }}>Screenshot Images (Optional)</Heading>
                    <Paragraph>1. Copy an image to clipboard (for example with Win+Shift+S).</Paragraph>
                    <Paragraph>2. Open YomiCord and add your card normally.</Paragraph>
                    <Paragraph>3. Include an image field mapping line like <strong>Image: {'{image}'}</strong>.</Paragraph>
                    <Paragraph>If no image is detected, the card still saves without an image.</Paragraph>

                    <div style={{ borderTop: "1px solid var(--border-subtle)", opacity: 0.8 }} />
                    <Heading tag="h5" style={{ margin: 0 }}>If deck loading fails</Heading>
                    <Paragraph>This is usually an AnkiConnect CORS allowlist issue.</Paragraph>
                    <Paragraph>Add these origins to webCorsOriginList and restart Anki:</Paragraph>
                    <textarea
                        value={ANKI_CORS_ORIGINS_TEMPLATE}
                        readOnly
                        rows={6}
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: 8,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--background-secondary)",
                            color: "var(--text-normal)",
                            fontFamily: "var(--font-code)",
                            fontSize: 12,
                            lineHeight: 1.4,
                            padding: 10,
                            resize: "none"
                        }}
                    />
                </div>
            ) : (
                <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <Heading tag="h4" style={{ margin: 0 }}>{typeMeta[activeType].label}</Heading>

                    <Heading tag="h5">Deck</Heading>
                    <SearchableSelect
                        placeholder={`Select ${typeMeta[activeType].label.toLowerCase()} deck`}
                        options={withCurrentOption(decks, activeDeck)}
                        value={activeDeck}
                        closeOnSelect
                        onChange={value => setDeckValue(activeType, value)}
                    />

                    <Heading tag="h5">Note Type</Heading>
                    <SearchableSelect
                        placeholder={`Select ${typeMeta[activeType].label.toLowerCase()} note type`}
                        options={withCurrentOption(models, activeModel)}
                        value={activeModel}
                        closeOnSelect
                        onChange={value => setModelValue(activeType, value)}
                    />

                    <Heading tag="h5">Field Mapping</Heading>
                    <Paragraph>One field per line: <strong>Field Name: {'{template}'}</strong></Paragraph>
                    <textarea
                        value={activeFieldMap}
                        onChange={event => setFieldMapValue(activeType, event.currentTarget.value)}
                        rows={7}
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: 8,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--background-secondary)",
                            color: "var(--text-normal)",
                            fontFamily: "var(--font-code)",
                            fontSize: 12,
                            lineHeight: 1.4,
                            padding: 10,
                            resize: "vertical"
                        }}
                    />
                    <Paragraph style={{ fontSize: 11, wordBreak: "break-word" }}>
                        {activeType === "kanji" ? KANJI_TOKEN_HELP_TEXT : WORD_TOKEN_HELP_TEXT}
                    </Paragraph>
                </div>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    autoAttachImage: {
        type: OptionType.BOOLEAN,
        description: "Automatically attach image from clipboard/message when adding cards",
        default: true,
        hidden: true
    },
    ankiDeckModelPicker: {
        type: OptionType.COMPONENT,
        description: "Load your decks/note types from Anki and pick them from dropdowns",
        component: AnkiDeckModelPicker
    },
    ankiConnectUrl: {
        type: OptionType.STRING,
        description: "AnkiConnect server URL",
        default: ANKI_CONNECT_URL_DEFAULT,
        hidden: true
    },
    ankiWordModelName: {
        type: OptionType.STRING,
        description: "Anki note type (model) for word cards",
        default: ANKI_MODEL_DEFAULT,
        hidden: true
    },
    ankiGrammarModelName: {
        type: OptionType.STRING,
        description: "Anki note type (model) for grammar cards",
        default: ANKI_MODEL_DEFAULT,
        hidden: true
    },
    ankiKanjiModelName: {
        type: OptionType.STRING,
        description: "Anki note type (model) for kanji cards",
        default: ANKI_MODEL_DEFAULT,
        hidden: true
    },
    ankiSentenceModelName: {
        type: OptionType.STRING,
        description: "Anki note type (model) for phrase / sentence cards",
        default: ANKI_MODEL_DEFAULT,
        hidden: true
    },
    ankiWordDeck: {
        type: OptionType.STRING,
        description: "Deck for word cards",
        default: ANKI_TERM_DECK,
        hidden: true
    },
    ankiGrammarDeck: {
        type: OptionType.STRING,
        description: "Deck for grammar cards",
        default: ANKI_GRAMMAR_DECK,
        hidden: true
    },
    ankiKanjiDeck: {
        type: OptionType.STRING,
        description: "Deck for kanji cards",
        default: ANKI_KANJI_DECK,
        hidden: true
    },
    ankiSentenceDeck: {
        type: OptionType.STRING,
        description: "Deck for phrase / whole-sentence cards",
        default: ANKI_SENTENCE_DECK,
        hidden: true
    },
    ankiWordFieldMap: {
        type: OptionType.STRING,
        description: "Word field mapping (one per line, e.g. Front: {expression})",
        default: ANKI_FIELD_MAP_DEFAULT,
        multiline: true,
        hidden: true
    },
    ankiGrammarFieldMap: {
        type: OptionType.STRING,
        description: "Grammar field mapping (one per line, e.g. Back: {meaning})",
        default: ANKI_FIELD_MAP_DEFAULT,
        multiline: true,
        hidden: true
    },
    ankiKanjiFieldMap: {
        type: OptionType.STRING,
        description: "Kanji field mapping (one per line, e.g. Front: {expression})",
        default: ANKI_FIELD_MAP_DEFAULT,
        multiline: true,
        hidden: true
    },
    ankiSentenceFieldMap: {
        type: OptionType.STRING,
        description: "Sentence field mapping (one per line, e.g. Back: {translation})",
        default: ANKI_FIELD_MAP_DEFAULT,
        multiline: true,
        hidden: true
    }
});

const YomiCordIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 4.75C5 4.06 5.56 3.5 6.25 3.5H17.75C18.44 3.5 19 4.06 19 4.75V19.25C19 19.94 18.44 20.5 17.75 20.5H6.25C5.56 20.5 5 19.94 5 19.25V4.75Z" fill="currentColor" fillOpacity="0.16" />
        <path d="M7.5 7H16.5M7.5 11H16.5M7.5 15H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M15.5 14.5L18.5 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="14" cy="13" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

async function callAnkiConnect<T = unknown>(action: string, params?: Record<string, unknown>) {
    const normalizeUrl = (url: string) => {
        const trimmed = url.trim();
        return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    };

    const configured = normalizeUrl(settings.store.ankiConnectUrl || ANKI_CONNECT_URL_DEFAULT);
    const urls = new Set<string>([configured]);

    try {
        const parsed = new URL(configured);
        if (parsed.hostname === "127.0.0.1") {
            parsed.hostname = "localhost";
            urls.add(normalizeUrl(parsed.toString()));
        } else if (parsed.hostname === "localhost") {
            parsed.hostname = "127.0.0.1";
            urls.add(normalizeUrl(parsed.toString()));
        }
    } catch {
        // If URL parsing fails, keep using configured URL only.
    }

    const errors: string[] = [];

    for (const url of urls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    version: 6,
                    params: params ?? {}
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const body = await response.json() as { result: T; error: string | null; };
            if (body.error) {
                throw new Error(`AnkiConnect API error: ${body.error}`);
            }

            return body.result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith("AnkiConnect API error:")) {
                throw new Error(message.replace("AnkiConnect API error: ", ""));
            }
            errors.push(`${url} -> ${message}`);
        }
    }

    throw new Error(`AnkiConnect unavailable. Tried: ${errors.join(" | ")}`);
}

function escapeAnkiQueryValue(value: string) {
    return value.replace(/["\\]/g, "\\$&");
}

function normalizeFieldValueForMatch(value: string) {
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function findExistingDuplicateNoteId(expression: string, sourceSentence: string, deckName: string, modelName: string) {
    const normalizedExpression = expression.trim();
    const normalizedSentence = sourceSentence.trim();
    if (!normalizedExpression) return null;

    const baseFilters = [
        `deck:"${escapeAnkiQueryValue(deckName)}"`,
        `note:"${escapeAnkiQueryValue(modelName)}"`
    ];

    const expressionQuery = [
        ...baseFilters,
        `"${escapeAnkiQueryValue(normalizedExpression)}"`
    ].join(" ");

    try {
        const expressionMatches = await callAnkiConnect<number[]>("findNotes", { query: expressionQuery });
        if (expressionMatches.length > 0) {
            const candidateIds = expressionMatches.slice(0, 40);
            const notes = await callAnkiConnect<Array<{
                noteId: number;
                fields: Record<string, { value: string; order: number; }>;
            }>>("notesInfo", { notes: candidateIds });

            const scored = notes
                .map(note => {
                    const values = Object.values(note.fields ?? {}).map(field => normalizeFieldValueForMatch(String(field?.value ?? "")));
                    let score = 0;
                    if (values.some(value => value === normalizedExpression)) score += 100;
                    if (values.some(value => value.startsWith(normalizedExpression) && value.length <= normalizedExpression.length + 8)) score += 40;
                    if (normalizedSentence && values.some(value => value === normalizedSentence)) score += 15;
                    return { noteId: note.noteId, score };
                })
                .sort((a, b) => b.score - a.score);

            if (scored.length > 0) return scored[0].noteId;
            return candidateIds[0];
        }
    } catch { }

    if (normalizedSentence && normalizedSentence !== normalizedExpression) {
        const sentenceQuery = [
            ...baseFilters,
            `"${escapeAnkiQueryValue(normalizedSentence)}"`
        ].join(" ");

        try {
            const sentenceMatches = await callAnkiConnect<number[]>("findNotes", { query: sentenceQuery });
            if (sentenceMatches.length > 0) return sentenceMatches[0];
        } catch { }
    }

    return null;
}

async function fetchJsonWithNativeFallback<T>(url: string): Promise<T | null> {
    try {
        const nativeResult = await Native.fetchJson(url) as T | null;
        if (nativeResult) return nativeResult;
    } catch {
        // Native bridge may be unavailable in non-desktop clients.
    }

    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json() as T;
    } catch {
        return null;
    }
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function guessImageExtension(mimeType: string, imageUrl = "") {
    const lowerMime = mimeType.toLowerCase();
    if (lowerMime.includes("png")) return "png";
    if (lowerMime.includes("jpeg") || lowerMime.includes("jpg")) return "jpg";
    if (lowerMime.includes("webp")) return "webp";
    if (lowerMime.includes("gif")) return "gif";

    const urlMatch = imageUrl.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/u)?.[1]?.toLowerCase();
    if (urlMatch && ["png", "jpg", "jpeg", "webp", "gif"].includes(urlMatch)) {
        return urlMatch === "jpeg" ? "jpg" : urlMatch;
    }

    return "png";
}

async function storeImageInAnkiMedia(base64Data: string, extension: string) {
    const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    const fileName = `yomicord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

    const storedName = await callAnkiConnect<string>("storeMediaFile", {
        filename: fileName,
        data: base64Data
    });

    return `<img src="${storedName || fileName}">`;
}

function buildImageFingerprint(base64Data: string, extension: string) {
    return `${extension.toLowerCase()}:${base64Data.length}:${base64Data.slice(0, 128)}`;
}

async function getClipboardImageHtml() {
    const imageUrlRegex = /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/iu;
    const dataUrlRegex = /^data:image\/(png|jpe?g|webp|gif);base64,/iu;

    const storeClipboardImageIfFresh = async (base64Data: string, extension: string) => {
        const fingerprint = buildImageFingerprint(base64Data, extension);
        if (fingerprint === lastClipboardImageFingerprint) return "";

        const html = await storeImageInAnkiMedia(base64Data, extension);
        if (html) {
            lastClipboardImageFingerprint = fingerprint;
        }
        return html;
    };

    // Desktop screenshots can live only in Electron clipboard buffers.
    try {
        const nativeBase64 = await Native.readClipboardImagePngBase64();
        if (nativeBase64) {
            return await storeClipboardImageIfFresh(nativeBase64, "png");
        }
    } catch {
        // Native helper is unavailable on web or may fail on some clients.
    }

    const tryClipboardTextImage = async () => {
        if (!navigator.clipboard?.readText) return "";

        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (!text) return "";

            if (dataUrlRegex.test(text)) {
                const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/u.exec(text);
                if (!match) return "";
                const extension = guessImageExtension(match[1]);
                return await storeClipboardImageIfFresh(match[2], extension);
            }

            if (imageUrlRegex.test(text)) {
                const response = await fetch(text);
                if (!response.ok) return "";
                const buffer = await response.arrayBuffer();
                const mimeType = response.headers.get("content-type") || "";
                const base64Data = bytesToBase64(new Uint8Array(buffer));
                const extension = guessImageExtension(mimeType, text);
                return await storeClipboardImageIfFresh(base64Data, extension);
            }
        } catch {
            // Clipboard text read can be blocked by platform permissions.
        }

        return "";
    };

    if (!navigator.clipboard?.read) {
        return tryClipboardTextImage();
    }

    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(type => type.startsWith("image/"));
            if (!imageType) continue;

            const blob = await item.getType(imageType);
            const buffer = await blob.arrayBuffer();
            const base64Data = bytesToBase64(new Uint8Array(buffer));
            const extension = guessImageExtension(imageType);
            return await storeClipboardImageIfFresh(base64Data, extension);
        }
    } catch {
        // Clipboard access may be blocked by platform permissions.
    }

    return tryClipboardTextImage();
}

function getMessageImageUrl(message?: Message) {
    if (!message) return "";

    const attachmentsObject = (message as any).attachments;
    const attachments = Array.isArray(attachmentsObject)
        ? attachmentsObject
        : Object.values(attachmentsObject ?? {});

    for (const attachment of attachments) {
        const contentType = String((attachment as any)?.content_type ?? "").toLowerCase();
        const fileName = String((attachment as any)?.filename ?? "").toLowerCase();
        const url = String((attachment as any)?.url ?? "");
        if (!url) continue;

        if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)(\?|#|$)/u.test(fileName || url)) {
            return url;
        }
    }

    const embeds = Array.isArray((message as any).embeds) ? (message as any).embeds : [];
    for (const embed of embeds) {
        const imageUrl = String(embed?.image?.url ?? embed?.thumbnail?.url ?? "");
        if (imageUrl) return imageUrl;
    }

    return "";
}

async function getMessageImageHtml(message?: Message) {
    const imageUrl = getMessageImageUrl(message);
    if (!imageUrl) return "";

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) return "";
        const buffer = await response.arrayBuffer();
        const mimeType = response.headers.get("content-type") || "";
        const base64Data = bytesToBase64(new Uint8Array(buffer));
        const extension = guessImageExtension(mimeType, imageUrl);
        return await storeImageInAnkiMedia(base64Data, extension);
    } catch {
        return "";
    }
}

async function resolveAutoImageHtml(message?: Message) {
    const clipboardImage = await getClipboardImageHtml();
    if (clipboardImage) return clipboardImage;

    const messageImage = await getMessageImageHtml(message);
    if (messageImage) return messageImage;

    return "";
}

async function lookupKanjiInfo(character: string) {
    const normalized = character.trim();
    if (!normalized || !isSingleKanji(normalized)) return null;

    const cached = kanjiInfoCache.get(normalized);
    if (cached) return cached;

    try {
        const body = await fetchJsonWithNativeFallback<{
            kunyomi?: string[];
            onyomi?: string[];
            kun_readings?: string[];
            on_readings?: string[];
            meanings?: string[];
            stroke_count?: number;
            grade?: number;
            jlpt?: number;
        }>(`https://kanjiapi.dev/v1/kanji/${encodeURIComponent(normalized)}`);
        if (!body) return null;

        const kunyomiList = Array.isArray(body.kunyomi) && body.kunyomi.length
            ? body.kunyomi
            : (Array.isArray(body.kun_readings) ? body.kun_readings : []);
        const onyomiList = Array.isArray(body.onyomi) && body.onyomi.length
            ? body.onyomi
            : (Array.isArray(body.on_readings) ? body.on_readings : []);

        const info = {
            kunyomi: kunyomiList.filter(Boolean).join(", "),
            onyomi: onyomiList.filter(Boolean).join(", "),
            keywords: Array.isArray(body.meanings) ? body.meanings.filter(Boolean).slice(0, 6).join(", ") : "",
            strokes: Number.isFinite(body.stroke_count) ? String(body.stroke_count) : "",
            grade: Number.isFinite(body.grade) ? String(body.grade) : "",
            jlpt: Number.isFinite(body.jlpt) ? `N${body.jlpt}` : ""
        };

        kanjiInfoCache.set(normalized, info);
        return info;
    } catch {
        return null;
    }
}

function inferReading(expression: string) {
    const trimmed = expression.trim();
    if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(trimmed)) {
        return trimmed;
    }

    return "";
}

function renderAnkiTemplate(template: string, data: AnkiTemplateData) {
    return template.replace(/\{(type|expression|meaning|glossary|reading|furigana|kunyomi|onyomi|keywords|strokes|grade|jlpt|sentence|translation|audio|image)\}/gi, (_match, key: string) => {
        const normalized = key.toLowerCase();
        if (normalized === "type") return data.type;
        if (normalized === "expression") return data.expression;
        if (normalized === "meaning" || normalized === "glossary") {
            return data.meaning || data.translation || data.sentence || data.expression;
        }
        if (normalized === "reading" || normalized === "furigana") {
            if (data.type === "kanji") return data.reading;
            return data.reading || data.expression;
        }
        if (normalized === "kunyomi") return data.kunyomi;
        if (normalized === "onyomi") return data.onyomi;
        if (normalized === "keywords") return data.keywords || data.meaning || "";
        if (normalized === "strokes") return data.strokes;
        if (normalized === "grade") return data.grade;
        if (normalized === "jlpt") return data.jlpt;
        if (normalized === "sentence") return data.sentence;
        if (normalized === "translation") return data.translation;
        if (normalized === "audio") return data.audio;
        if (normalized === "image") return data.image;
        return "";
    });
}

function buildMappedFields(mappingText: string, data: AnkiTemplateData) {
    const fields: Record<string, string> = {};

    for (const rawLine of mappingText.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) continue;

        const splitIndex = line.indexOf(":");
        if (splitIndex <= 0) continue;

        const fieldName = line.slice(0, splitIndex).trim();
        const template = line.slice(splitIndex + 1).trim();
        if (!fieldName || !template) continue;

        fields[fieldName] = renderAnkiTemplate(template, data);
    }

    if (Object.keys(fields).length === 0) {
        return {
            Front: data.expression,
            Back: data.meaning
        };
    }

    return fields;
}

async function buildFieldsForModel(modelName: string, mappingText: string, data: AnkiTemplateData) {
    const mappedFields = buildMappedFields(mappingText, data);
    const fallbackPrimary = [data.expression, data.meaning, data.sentence, data.translation]
        .find(value => value.trim().length > 0) ?? "[empty]";
    const fallbackMeaning = [data.meaning, data.translation, data.sentence, data.expression]
        .find(value => value.trim().length > 0) ?? fallbackPrimary;
    const fallbackReading = [data.reading, data.expression]
        .find(value => value.trim().length > 0) ?? fallbackPrimary;

    const fillCommonSemanticFields = (fields: Record<string, string>) => {
        const normalized = { ...fields };

        for (const key of Object.keys(normalized)) {
            const lower = key.toLowerCase();
            const current = String(normalized[key] ?? "").trim();
            if (current) continue;

            if (/(^|\s|\(|_)meaning|gloss|\bback\b/.test(lower)) {
                normalized[key] = fallbackMeaning;
            } else if (/reading|furigana/.test(lower)) {
                normalized[key] = fallbackReading;
            }
        }

        return normalized;
    };

    const ensureSemanticFieldPresence = (fields: Record<string, string>, modelFieldNames: string[]) => {
        const normalized = { ...fields };

        const hasMeaningLike = Object.keys(normalized).some(key => /(^|\s|\(|_)meaning|gloss|\bback\b/.test(key.toLowerCase()));
        if (!hasMeaningLike) {
            const meaningField = modelFieldNames.find(fieldName => /(^|\s|\(|_)meaning|gloss|\bback\b/.test(fieldName.toLowerCase()));
            if (meaningField) normalized[meaningField] = fallbackMeaning;
        }

        const hasReadingLike = Object.keys(normalized).some(key => /reading|furigana/.test(key.toLowerCase()));
        if (!hasReadingLike) {
            const readingField = modelFieldNames.find(fieldName => /reading|furigana/.test(fieldName.toLowerCase()));
            if (readingField) normalized[readingField] = fallbackReading;
        }

        return normalized;
    };

    const ensurePrimaryField = (fields: Record<string, string>, modelFieldNames: string[]) => {
        const normalized = { ...fields };
        if (!modelFieldNames.length) {
            return normalized;
        }

        const primaryField = modelFieldNames[0];
        const hasAnyContent = Object.values(normalized).some(value => value.trim().length > 0);
        if (!hasAnyContent || !String(normalized[primaryField] ?? "").trim()) {
            normalized[primaryField] = fallbackPrimary;
        }

        return normalized;
    };

    let modelFieldNames: string[] = [];
    try {
        modelFieldNames = await callAnkiConnect<string[]>("modelFieldNames", { modelName });
    } catch {
        return fillCommonSemanticFields(mappedFields);
    }

    if (!modelFieldNames.length) {
        return fillCommonSemanticFields(mappedFields);
    }

    const filteredFields: Record<string, string> = {};
    for (const fieldName of modelFieldNames) {
        if (Object.prototype.hasOwnProperty.call(mappedFields, fieldName)) {
            filteredFields[fieldName] = mappedFields[fieldName];
        }
    }

    // Inject audio directly into the model's Audio field if not already populated via field map.
    if (data.audio && !Object.values(filteredFields).some(v => v.includes("[sound:"))) {
        const audioField = modelFieldNames.find(f => /^audio$/i.test(f));
        if (audioField) filteredFields[audioField] = data.audio;
    }

    if (Object.keys(filteredFields).length > 0) {
        return fillCommonSemanticFields(ensurePrimaryField(ensureSemanticFieldPresence(filteredFields, modelFieldNames), modelFieldNames));
    }

    // Safe fallback for models whose field names don't match current mapping.
    if (modelFieldNames.includes("Front")) {
        filteredFields.Front = data.expression;
    }
    if (modelFieldNames.includes("Back")) {
        filteredFields.Back = data.meaning;
    }

    if (Object.keys(filteredFields).length > 0) {
        return fillCommonSemanticFields(ensurePrimaryField(ensureSemanticFieldPresence(filteredFields, modelFieldNames), modelFieldNames));
    }

    filteredFields[modelFieldNames[0]] = data.expression;
    if (modelFieldNames[1]) {
        filteredFields[modelFieldNames[1]] = data.meaning;
    }

    return fillCommonSemanticFields(ensurePrimaryField(ensureSemanticFieldPresence(filteredFields, modelFieldNames), modelFieldNames));
}

function isSingleKanji(text: string) {
    return SINGLE_KANJI_REGEX.test(text.trim());
}

function hasKanji(text: string) {
    return /[\p{Script=Han}]/u.test(text);
}

function extractKanjiContext(tokens: string[]) {
    const map = new Map<string, { words: Set<string>; firstSeen: number; }>();
    const firstWordIndex = new Map<string, number>();

    for (const [tokenIndex, token] of tokens.entries()) {
        if (!hasKanji(token)) continue;

        if (!firstWordIndex.has(token)) {
            firstWordIndex.set(token, tokenIndex);
        }

        const chars = token.match(/[\p{Script=Han}]/gu) ?? [];
        for (const kanji of chars) {
            if (!map.has(kanji)) {
                map.set(kanji, {
                    words: new Set<string>(),
                    firstSeen: tokenIndex
                });
            }
            const entry = map.get(kanji)!;
            entry.words.add(token);
            if (tokenIndex < entry.firstSeen) {
                entry.firstSeen = tokenIndex;
            }
        }
    }

    return Array.from(map.entries())
        .sort((a, b) => a[1].firstSeen - b[1].firstSeen)
        .map(([kanji, entry]) => ({
            kanji,
            words: Array.from(entry.words).sort((a, b) => (firstWordIndex.get(a) ?? 0) - (firstWordIndex.get(b) ?? 0))
        })) as KanjiContextEntry[];
}

function extractSegmentGrammarPoints(segment: ClauseBreakdown): GrammarPointEntry[] {
    const entries: GrammarPointEntry[] = [];
    const seen = new Set<string>();

    const toNaturalGrammarExplanation = (surface: string, point: string, explanation: string) => {
        if (/ちゃった$|じゃった$/u.test(surface)) {
            if (/忘|わす/u.test(surface)) {
                return "forget with an 'oops' feeling";
            }
            return "did it / ended up doing it with an 'oops' feeling";
        }

        if (/てしまった$|でしまった$/u.test(surface)) {
            return "ended up doing it (often with regret)";
        }

        if (/んです$|のです$|んだ$|のだ$/u.test(surface)) {
            return "adds an explanatory tone";
        }

        if (point === "to + omou") {
            return "I think ...";
        }

        return explanation;
    };

    const add = (surface: string, point: string, explanation: string) => {
        const normalizedSurface = surface.trim();
        if (!normalizedSurface || !explanation.trim()) return;
        const key = `${normalizedSurface}::${point}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({
            surface: normalizedSurface,
            point,
            explanation: toCompactGrammarExplanation(toNaturalGrammarExplanation(normalizedSurface, point, explanation)),
            source: segment.source,
            translation: segment.translation
        });
    };

    const withTopicContext = (token: string, explanation: string) => {
        const stem = token
            .replace(/(って|た|て|ない|なかった|ます|ました|ません|けど|けれど)$/u, "")
            .trim();
        if (!stem) return explanation;

        const stemMeaning = glossToken(stem).trim();
        if (!stemMeaning) return explanation;
        if (stemMeaning.includes("marker") || stemMeaning.includes("form") || stemMeaning.includes("particle")) {
            return explanation;
        }

        return `${explanation} (about ${stemMeaning})`;
    };

    const toCompactGrammarExplanation = (text: string) => {
        return text
            .replace("sentence-ending particle", "ending")
            .replace("topic marker", "marks topic")
            .replace("subject marker", "marks subject")
            .replace("object marker", "marks object")
            .replace("question marker", "marks question")
            .replace("polite copula", "polite 'is'")
            .replace("copula", "'is'")
            .replace("conditional", "if-form")
            .replace("approximately", "about")
            .replace("contracted", "short")
            .replace(/\s{2,}/g, " ")
            .trim();
    };

    const isMeaningfulLexicalGloss = (gloss: string) => {
        return Boolean(gloss)
            && !/(marker|particle|form|ending|copula|conditional|modality|negative|past|connector)/i.test(gloss);
    };

    const inferGrammarTarget = (token: string, tokenIndex: number, tokens: string[]) => {
        const strippedStem = token
            .replace(/(なかった|ない|ました|ます|た|て|ちゃった|じゃった|ちゃう|じゃう|んです|のです|んだ|のだ|ば|たら|なら|けど|けれど|って)$/u, "")
            .trim();

        const candidates: string[] = [];
        if (strippedStem) candidates.push(strippedStem);

        for (let i = tokenIndex - 1; i >= 0 && candidates.length < 4; i--) {
            const previous = tokens[i]?.trim();
            if (!previous) continue;
            if (COMMON_GRAMMAR_GLOSSES[previous]) continue;
            if (PUNCTUATION_REGEX.test(previous) || SYMBOL_ONLY_REGEX.test(previous)) continue;
            candidates.push(previous);
        }

        for (const candidate of candidates) {
            const gloss = glossToken(candidate).trim();
            if (isMeaningfulLexicalGloss(gloss)) {
                return `${candidate} (${gloss})`;
            }
        }

        return "";
    };

    const detectByPattern = (token: string, tokenIndex: number, tokens: string[], hasDirectGrammarMatch: boolean) => {
        const target = inferGrammarTarget(token, tokenIndex, tokens);
        const withTarget = (base: string, fallbackTarget?: string) => {
            if (target) return `${base} of ${target}`;
            if (fallbackTarget) return `${base} of ${fallbackTarget}`;
            return base;
        };

        if (/ちゃった$|じゃった$/u.test(token)) {
            add(token, "ちゃった/じゃった", withTarget("did it / ended up doing it with an 'oops' feeling"));
            return;
        }
        if (/って$/u.test(token) && token.length > 2) {
            add(token, "って", withTopicContext(token, "casual quote/topic marker"));
            return;
        }
        if (/んです$|のです$|んだ$|のだ$/u.test(token)) {
            add(token, "explanatory", "adds explanation tone");
        }
        if (/と思う$/u.test(token)) {
            add(token, "to + omou", "quotes phrase + 'I think'");
        }
        if (/ている$|でいる$|てる$|でる$/u.test(token)) {
            add(token, "progressive", withTarget("ongoing/state form", "the previous verb"));
        }
        if (!hasDirectGrammarMatch && /て$/u.test(token) && token.length > 1) {
            add(token, "te-form", withTopicContext(token, withTarget("connects actions", "the previous verb")));
        }
        if (!hasDirectGrammarMatch && /なかった$/u.test(token) && token.length > 2) {
            add(token, "past negative", withTarget("past negative form", "the previous verb"));
        } else if (!hasDirectGrammarMatch && /た$/u.test(token) && token.length > 1) {
            add(token, "past", withTarget("plain past", "the previous verb"));
        }
        if (!hasDirectGrammarMatch && /ない$/u.test(token) && token.length > 2) {
            add(token, "negative", withTarget("plain negative form", "the previous verb"));
        }
        if (/じゃない$|ではない$/u.test(token)) {
            add(token, "copula negative", withTarget("negates 'is'", "the statement"));
        }
        if (!hasDirectGrammarMatch && /ば$|たら$|なら$/u.test(token)) {
            add(token, "conditional", "if/when condition");
        }
        if (!hasDirectGrammarMatch && /そう$|らしい$|でしょう$|だろう$|かな$|かも$/u.test(token)) {
            add(token, "modality", "uncertainty/likelihood");
        }
    };

    for (const [tokenIndex, token] of segment.tokens.entries()) {
        const directGrammar = COMMON_GRAMMAR_GLOSSES[token];
        const hasDirectGrammarMatch = Boolean(directGrammar);

        if (directGrammar) {
            add(token, token, directGrammar);
        }

        detectByPattern(token, tokenIndex, segment.tokens, hasDirectGrammarMatch);
    }

    return entries;
}

async function fetchAudioForAnki(expression: string, reading: string): Promise<string> {
    const kana = reading || inferReading(expression) || expression;
    if (!kana) return "";
    const kanji = /[\p{Script=Han}]/u.test(expression) ? expression : "";
    const url = `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=${encodeURIComponent(kanji)}&kana=${encodeURIComponent(kana)}`;

    let base64 = "";
    try {
        // Native path bypasses renderer CSP for external binary fetches.
        base64 = await Native.fetchBinaryAsBase64(url);
    } catch { }

    if (!base64) {
        try {
            const response = await fetch(url, { headers: { "Referer": "https://jisho.org" } });
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                if (buffer.byteLength > 500) base64 = bytesToBase64(new Uint8Array(buffer));
            }
        } catch { }
    }

    if (!base64) return "";
    try {
        const fileName = `yomicord_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
        await callAnkiConnect("storeMediaFile", { filename: fileName, data: base64 });
        return `[sound:${fileName}]`;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ text: `YomiCord: Audio failed to store in Anki (${msg})`, variant: "critical" });
        return "";
    }
}

async function addTermToAnki(expression: string, meaning: string, sourceSentence: string, translation: string, image: string, deckName: string, modelName: string, fieldMap: string, cardType: AnkiCardType, tags: string[] = ["yomicord"]) {
    let jishoMeaning = "";
    let jishoReading = "";
    try {
        const jisho = await lookupJishoWordInfo(expression);
        jishoMeaning = jisho?.meaning ?? "";
        jishoReading = jisho?.reading ?? "";
    } catch { }

    const normalizedMeaning = [jishoMeaning, meaning, translation, sourceSentence, expression]
        .map(value => value.trim())
        .find(value => value.length > 0) ?? expression;

    const resolvedReading = jishoReading || inferReading(expression);
    // Always attempt audio regardless of field map; injected directly into Audio model field below.
    const audio = await fetchAudioForAnki(expression, resolvedReading);

    const templateData: AnkiTemplateData = {
        type: cardType,
        expression,
        meaning: normalizedMeaning,
        reading: resolvedReading,
        kunyomi: "",
        onyomi: "",
        keywords: "",
        strokes: "",
        grade: "",
        jlpt: "",
        sentence: sourceSentence,
        translation,
        audio,
        image
    };

    return callAnkiConnect<number>("addNote", {
        note: {
            deckName,
            modelName,
            fields: await buildFieldsForModel(modelName, fieldMap, templateData),
            tags
        }
    });
}

async function addKanjiToAnki(character: string, meaning: string, sourceSentence: string, translation: string, image: string, deckName: string, modelName: string, fieldMap: string) {
    let jishoMeaning = "";
    let jishoKunyomi = "";
    let kunyomi = "";
    let onyomi = "";
    let keywords = "";
    let strokes = "";
    let grade = "";
    let jlpt = "";
    try {
        const jisho = await lookupJishoKanjiCardInfo(character);
        jishoMeaning = jisho?.meaning ?? "";
        jishoKunyomi = jisho?.kunyomi ?? "";
    } catch { }

    try {
        const info = await lookupKanjiInfo(character);
        kunyomi = info?.kunyomi ?? "";
        onyomi = info?.onyomi ?? "";
        keywords = info?.keywords ?? "";
        strokes = info?.strokes ?? "";
        grade = info?.grade ?? "";
        jlpt = info?.jlpt ?? "";
    } catch { }

    const keywordMeaning = keywords
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((entry, index) => `${index + 1}. ${entry}`)
        .join("\n")
        .trim();

    const normalizedMeaning = [jishoMeaning, keywordMeaning, meaning, character]
        .map(value => value.trim())
        .find(value => value.length > 0) ?? character;

    const templateData: AnkiTemplateData = {
        type: "kanji",
        expression: character,
        meaning: normalizedMeaning,
        reading: jishoKunyomi || kunyomi || onyomi,
        kunyomi: jishoKunyomi || kunyomi,
        onyomi,
        keywords,
        strokes,
        grade,
        jlpt,
        sentence: sourceSentence,
        translation,
        audio: "",
        image
    };

    return callAnkiConnect<number>("addNote", {
        note: {
            deckName,
            modelName,
            fields: await buildFieldsForModel(modelName, fieldMap, templateData),
            tags: ["yomicord", "kanji"]
        }
    });
}

function detectLookupMode(text: string) {
    const trimmed = text.trim();
    return SINGLE_KANJI_REGEX.test(trimmed) ? "kanji" : "term";
}

function sanitizeLookupText(raw: string) {
    const lines = raw
        .replace(/:[a-z0-9_+-]+:/gi, " ")
        .split(/\r?\n/)
        .map(line => line.trim().replace(/^\d+[.)]\s*/u, ""))
        .filter(line => line.length > 0)
        .filter(line => !UI_NOISE_LINE_REGEX.test(line))
        .map(line => line.replace(/\s+/g, " ").trim());

    const hasJapaneseLine = lines.some(line => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line));
    const filtered = hasJapaneseLine
        ? lines.filter(line => {
            const hasJapanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line);
            if (hasJapanese) return true;

            // Drop short nickname-style lines (e.g. "Bonker :3") from mixed selections.
            if (line.length > 32) return true;
            if (/[。！？.!?]/u.test(line)) return true;
            const wordCount = line.split(/\s+/u).filter(Boolean).length;
            return wordCount > 3;
        })
        : lines;

    return filtered
        .join("\n")
        .trim();
}

function japaneseCharRatio(text: string) {
    if (!text) return 0;
    const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    return (matches?.length ?? 0) / Math.max(text.length, 1);
}

function getSelectedLookupText(message?: Message) {
    const rawSelection = window.getSelection?.()?.toString() ?? "";
    const selected = sanitizeLookupText(rawSelection);
    const messageText = sanitizeLookupText(message?.content ?? "");

    if (!selected) return messageText;
    if (!messageText) return selected;

    const selectionSpansMultipleItems = /\n/u.test(selected) || /^\d+[.)]\s*/mu.test(rawSelection);

    if (selectionSpansMultipleItems) {
        return selected;
    }

    if (selected.includes(messageText) && selected.length > messageText.length + 12) {
        return selected;
    }

    if (selected.includes(messageText)) return messageText;
    if (messageText.includes(selected)) return selected;

    const selectedJpRatio = japaneseCharRatio(selected);
    const messageJpRatio = japaneseCharRatio(messageText);

    if (selectedJpRatio < 0.35 && messageJpRatio > selectedJpRatio + 0.2) {
        return messageText;
    }

    return selected;
}

function splitIntoClauses(text: string) {
    const normalized = text
        .replace(/[.]{2,}/g, "…")
        .replace(/\r\n/g, "\n")
        .replace(/^\d+[.)]\s*/gmu, "");

    return normalized
        .split(/\n+/u)
        .flatMap(line => line.split(/(?<=[。！？!?…]|[、,])/u))
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !PUNCTUATION_REGEX.test(part))
        .filter(part => !SYMBOL_ONLY_REGEX.test(part));
}

function tokenizeJapanese(text: string) {
    return segmenter.segment(text)
        .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !PUNCTUATION_REGEX.test(token))
    .filter(token => !SYMBOL_ONLY_REGEX.test(token));
}

function shouldShowBreakdown(text: string) {
    const normalized = text.trim();
    if (!normalized) return false;

    if (/[\s　]|[。！？!?、,\n]/u.test(normalized)) return true;

    const mergedTokens = mergeJapaneseTokens(tokenizeJapanese(normalized));
    if (mergedTokens.length <= 1) return false;

    if (mergedTokens.length === 2 && INFLECTION_ENDINGS.has(mergedTokens[1])) {
        return false;
    }

    return true;
}

function mergeJapaneseTokens(tokens: string[]) {
    const merged: string[] = [];
    const particles = new Set(["は", "が", "を", "に", "で", "と", "も", "の", "ね", "よ", "か", "な", "さ", "わ", "へ"]);
    const conjugationSuffixTokens = new Set([
        "て", "で", "た", "だ", "ない", "なかった", "なくて", "なきゃ",
        "ます", "ました", "ません", "たい", "れば", "ば",
        "れる", "られる", "せる", "させる", "させられる",
        "ちゃう", "じゃう", "ちゃった", "じゃった",
        "そう", "らしい", "だろう", "でしょう", "かも", "かな"
    ]);
    const canAttachToPrevious = (previous: string) => {
        if (!previous) return false;
        if (particles.has(previous)) return false;
        if (PUNCTUATION_REGEX.test(previous) || SYMBOL_ONLY_REGEX.test(previous)) return false;
        return true;
    };

    for (const rawToken of tokens) {
        const token = rawToken.trim();
        if (!token || PUNCTUATION_REGEX.test(token)) continue;

        const previous = merged[merged.length - 1];

        if (token === "ば" && previous) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        // Keep conjugated verb chunks together (e.g. 行っ + て + い + る -> 行っている).
        if (token === "い" && previous?.endsWith("て")) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        if (token === "る" && previous && (previous.endsWith("てい") || previous.endsWith("でい"))) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        if ((token === "た" || token === "る") && previous && /[てで]い$/u.test(previous)) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        if (conjugationSuffixTokens.has(token) && canAttachToPrevious(previous || "")) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        if ((token === "て" || token === "で" || token === "た" || token === "だ") && canAttachToPrevious(previous || "")) {
            const prevLast = previous!.slice(-1);
            if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々]/u.test(prevLast) || prevLast === "っ" || prevLast === "ん") {
                merged[merged.length - 1] = `${previous}${token}`;
                continue;
            }
        }

        if (token === "て" && previous === "し") {
            merged[merged.length - 1] = "して";
            continue;
        }

        if (token === "か" && previous?.endsWith("です")) {
            merged[merged.length - 1] = `${previous}か`;
            continue;
        }

        if (token === "ですか" && previous === "いい") {
            merged[merged.length - 1] = "いいですか";
            continue;
        }

        if (token === "た" && previous && /[ちじ]ゃっ$/u.test(previous)) {
            merged[merged.length - 1] = `${previous}${token}`;
            continue;
        }

        if (token === "です" && previous === "いい") {
            merged[merged.length - 1] = "いいです";
            continue;
        }

        if (previous && /^[\p{Script=Hiragana}ー]+$/u.test(previous) && /^[\p{Script=Hiragana}ー]+$/u.test(token)) {
            const combinedKanaWord = `${previous}${token}`;
            if (MULTI_TOKEN_COMPOUNDS.has(combinedKanaWord)) {
                merged[merged.length - 1] = combinedKanaWord;
                continue;
            }
        }

        merged.push(token);
    }

    return merged;
}

function glossToken(token: string) {
    const inferDictionaryFromConjugation = (surface: string) => {
        if (CONJUGATION_OVERRIDES[surface]) {
            return CONJUGATION_OVERRIDES[surface].dictionary;
        }

        if (surface.endsWith("して") && surface.length > 2) {
            return `${surface.slice(0, -2)}する`;
        }
        if (surface.endsWith("いて") && surface.length > 2) {
            return `${surface.slice(0, -2)}く`;
        }
        if (surface.endsWith("いで") && surface.length > 2) {
            return `${surface.slice(0, -2)}ぐ`;
        }
        if (surface.endsWith("って") && surface.length > 2) {
            return `${surface.slice(0, -2)}る`;
        }
        if (surface.endsWith("んで") && surface.length > 2) {
            return `${surface.slice(0, -2)}む/ぶ/ぬ`;
        }
        if (surface.endsWith("した") && surface.length > 2) {
            return `${surface.slice(0, -2)}する`;
        }
        if (surface.endsWith("いた") && surface.length > 2) {
            return `${surface.slice(0, -2)}く`;
        }
        if (surface.endsWith("いだ") && surface.length > 2) {
            return `${surface.slice(0, -2)}ぐ`;
        }
        if (surface.endsWith("った") && surface.length > 2) {
            return `${surface.slice(0, -2)}る/う/つ`;
        }
        if (surface.endsWith("んだ") && surface.length > 2) {
            return `${surface.slice(0, -2)}む/ぶ/ぬ`;
        }
        return "";
    };

    const explainConjugation = (surface: string) => {
        if (CONJUGATION_OVERRIDES[surface]) {
            const forced = CONJUGATION_OVERRIDES[surface];
            return `${surface} (${forced.dictionary}, ${forced.form}): ${forced.meaning}`;
        }

        const dictionary = inferDictionaryFromConjugation(surface);

        if (surface.endsWith("て") && dictionary) {
            return `${surface} (${dictionary}, te-form): connective verb form (and/then ...)`;
        }

        if (surface.endsWith("た") && dictionary) {
            return `${surface} (${dictionary}, plain past): past tense`;
        }

        if (surface.endsWith("ない") && surface.length > 2) {
            return `${surface} (negative form): not / do not`;
        }

        return "";
    };

    const directGlosses: Record<string, string> = {
        "どう": "how",
        "たくさん": "many / a lot",
        "みなさん": "everyone",
        "たぶん": "probably / maybe",
        "すこし": "a little",
        "パン": "bread",
        "シャワー": "shower",
        "して": "do (from する = to do; te-form)",
        "くる": "come / go and come back",
        "またね": "see you later / bye for now",
        "する": "to do",
        "でも": "but / however",
        "なんか": "like / kind of / something",
        "って": "quoting/topic marker (casual)",
        "やつ": "thing / one (casual)",
        "けど": "but / though",
        "なかった": "was not / didn't",
        "私": "I / me",
        "僕": "I / me (usually male)",
        "俺": "I / me (casual, masculine)",
        "言えば": "if you say it / how to put it",
        "いいですか": "is it okay? / should I?",
        "いいです": "is okay / is good",
        "ですか": "polite question ending",
        "わすれちゃった": "forget with an 'oops' feeling",
        "忘れちゃった": "forget with an 'oops' feeling",
        "わすれた": "forgot",
        "忘れた": "forgot",
        "か": "question marker",
        "は": "topic marker",
        "を": "object marker",
        "が": "subject marker",
        "に": "to / at / in",
        "で": "at / by / with",
        "と": "and / with / quote marker",
        "も": "also / too",
        "の": "of / possession marker"
    };

    const conjugationExplanation = explainConjugation(token);
    if (conjugationExplanation) return conjugationExplanation;

    if (COMMON_GRAMMAR_GLOSSES[token]) return COMMON_GRAMMAR_GLOSSES[token];
    if (directGlosses[token]) return directGlosses[token];
    if (/ちゃった$/u.test(token) || /じゃった$/u.test(token)) return "with an 'oops' feeling / ended up doing";
    if (/ば$/u.test(token)) return "conditional form ('if ...')";
    if (/ですか$/u.test(token)) return "polite question ending";
    if (/^[\p{Script=Han}]+えば$/u.test(token)) return "conditional form meaning 'if [you] ...'";
    if (/ている$/u.test(token) || /てる$/u.test(token)) return "progressive/state form ('is doing' / 'have been doing')";
    if (/てしまう$/u.test(token) || /でしまう$/u.test(token)) return "completion/regret nuance ('end up doing')";
    if (/てしまった$/u.test(token) || /でしまった$/u.test(token)) return "completed/regret nuance ('ended up doing')";
    if (/なければ$/u.test(token)) return "must do / if not ...";
    if (/なくてもいい$/u.test(token)) return "do not have to ...";
    if (/てもいい$/u.test(token)) return "may do / it's okay to ...";
    if (/てはいけない$/u.test(token) || /ちゃだめ$/u.test(token)) return "must not do / not allowed";
    if (/ことがある$/u.test(token)) return "there are times when / have done before";
    if (/ことにする$/u.test(token)) return "decide to do";
    if (/ことになる$/u.test(token)) return "it becomes decided / come to be";
    if (/つもり$/u.test(token)) return "intend to / plan to";
    if (/ために$/u.test(token)) return "for the purpose of / in order to";
    if (/ように$/u.test(token)) return "so that / in order to / in the manner of";
    if (/ながら$/u.test(token)) return "while doing";
    if (/られる$/u.test(token)) return "potential/passive ending";
    if (/させる$/u.test(token)) return "causative ending (make/let do)";
    if (/そう$/u.test(token)) return "seems / appears / I heard that (context)";
    if (/らしい$/u.test(token)) return "apparently / seems like / typical of";
    if (/でしょう$/u.test(token) || /だろう$/u.test(token)) return "probably / likely";
    if (/かな$/u.test(token) || /かも$/u.test(token)) return "uncertainty marker ('maybe / I wonder')";
    if (/^[\p{Script=Katakana}ー]+$/u.test(token)) return "";
    if (/^[\p{Script=Hiragana}ー]+$/u.test(token)) return "";
    if (/^[\p{Script=Han}々]+$/u.test(token)) return "";
    if (/^[A-Za-z]+$/u.test(token)) return token.toLowerCase();
    if (/^[0-9]+$/u.test(token)) return "numeric value";

    return "";
}

function splitGlossToken(token: string) {
    if (/(て|で|た|だ|ない|なかった|ます|ました|ません|たい|ちゃう|じゃう|ちゃった|じゃった|れる|られる)$/u.test(token)) {
        return [{ surface: token, gloss: glossToken(token) }];
    }

    if (token === "して") {
        return [
            { surface: "して (する)", gloss: "do (from する = to do; te-form)" }
        ];
    }

    if (token === "わすれちゃった" || token === "忘れちゃった") {
        return [
            { surface: "わすれ (忘れ)", gloss: "forget" },
            { surface: "ちゃった", gloss: '"did it / ended up doing it" (with an "oops" feeling)' }
        ];
    }

    if (token === "わすれた" || token === "忘れた") {
        return [
            { surface: "わすれ (忘れ)", gloss: "forget" },
            { surface: "た", gloss: "past tense marker" }
        ];
    }

    if (/ちゃった$/u.test(token) || /じゃった$/u.test(token)) {
        const stem = token.replace(/([ちじ]ゃった)$/u, "").trim();
        if (stem) {
            return [
                { surface: stem, gloss: glossToken(stem) },
                { surface: token.slice(stem.length), gloss: '"did it / ended up doing it" (with an "oops" feeling)' }
            ];
        }
    }

    return [{ surface: token, gloss: glossToken(token) }];
}

function isUsefulTranslation(source: string, translated: string) {
    const cleanSource = source.trim().toLowerCase();
    const cleanTranslated = translated.trim().toLowerCase();
    if (!cleanTranslated) return false;
    if (cleanTranslated === cleanSource) return false;
    if (PUNCTUATION_REGEX.test(cleanTranslated)) return false;
    return true;
}

function summarizeClauseMeaning(clauseTranslation: string, token: string) {
    const trimmed = clauseTranslation.trim();
    if (!trimmed) return `role in phrase containing ${token}`;
    const shortened = trimmed.length > 90 ? `${trimmed.slice(0, 90)}...` : trimmed;
    return `from clause meaning: ${shortened}`;
}

function normalizeDefinitionForKey(value: string) {
    return value
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .replace(/[^a-z0-9\s'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanJishoDefinition(value: string) {
    return value
        .replace(/^to\s+/iu, "")
        .replace(/\s*\((usually|often|esp\.?|especially|colloquial|archaic|rare)\)$/iu, "")
        .replace(/\s+/g, " ")
        .trim();
}

function formatJishoMeaningForCard(senses: Array<{ english_definitions?: string[]; }>) {
    const rows: string[] = [];
    const seen = new Set<string>();

    for (const sense of senses.slice(0, 4)) {
        const cleaned = (sense.english_definitions ?? [])
            .map(cleanJishoDefinition)
            .filter(Boolean)
            .filter(def => !/^(wikipedia definition|see also)$/iu.test(def));

        const uniquePerSense: string[] = [];
        for (const def of cleaned) {
            const key = normalizeDefinitionForKey(def);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            uniquePerSense.push(def);
            if (uniquePerSense.length >= 2) break;
        }

        if (!uniquePerSense.length) continue;
        rows.push(uniquePerSense.join("; "));
        if (rows.length >= 3) break;
    }

    return rows.map((row, index) => `${index + 1}. ${row}`).join(" | ").trim();
}

function firstGlossLine(meaning: string) {
    const first = meaning
        .split("|")
        .map(part => part.trim())
        .filter(Boolean)[0] ?? "";
    return first.replace(/^\d+\.\s*/u, "").trim();
}

function toMultilineMeaning(meaning: string) {
    return meaning
        .split("|")
        .map(part => part.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

async function lookupJishoWordInfo(term: string) {
    const normalized = term.trim();
    if (!normalized) return null;

    const cachedMeaning = jishoMeaningCache.get(normalized);
    const cachedReading = jishoReadingCache.get(normalized);
    if (cachedMeaning || cachedReading) {
        return {
            meaning: cachedMeaning ?? "",
            reading: cachedReading ?? ""
        };
    }

    const body = await fetchJsonWithNativeFallback<{
        data?: Array<{
            slug?: string;
            japanese?: Array<{ word?: string; reading?: string; }>;
            senses?: Array<{ english_definitions?: string[]; parts_of_speech?: string[]; }>;
        }>;
    }>(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(normalized)}`);
    if (!body) return null;

    const entries = body.data ?? [];
    if (!entries.length) return null;

    const picked = entries.find(entry => {
        if (entry.slug === normalized) return true;
        return (entry.japanese ?? []).some(j => j.word === normalized || j.reading === normalized);
    }) ?? entries[0];

    const meaning = formatJishoMeaningForCard(
        (picked.senses ?? []).map(sense => ({ english_definitions: sense.english_definitions }))
    );

    const reading = (picked.japanese ?? []).find(j => j.word === normalized)?.reading
        ?? (picked.japanese ?? [])[0]?.reading
        ?? "";

    if (meaning) jishoMeaningCache.set(normalized, meaning);
    if (reading) jishoReadingCache.set(normalized, reading);

    if (!meaning && !reading) return null;
    return { meaning, reading };
}

async function lookupJishoKanjiCardInfo(character: string) {
    const normalized = character.trim();
    if (!normalized || !isSingleKanji(normalized)) return null;

    const body = await fetchJsonWithNativeFallback<{
        data?: Array<{
            slug?: string;
            japanese?: Array<{ word?: string; reading?: string; }>;
            senses?: Array<{ english_definitions?: string[]; }>;
        }>;
    }>(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(normalized)}`);
    if (!body) return null;

    const entries = body.data ?? [];
    if (!entries.length) return null;

    const picked = entries.find(entry => {
        return (entry.japanese ?? []).some(j => String(j.word ?? "").includes(normalized));
    }) ?? entries[0];

    const normalizeDefinition = (value: string) => value
        .replace(/^to\s+/iu, "")
        .replace(/^\([^)]*\)\s*/u, "")
        .trim();

    const senseLabels = (picked.senses ?? [])
        .slice(0, 3)
        .map(sense => {
            const defs = (sense.english_definitions ?? [])
                .map(normalizeDefinition)
                .filter(Boolean);
            if (!defs.length) return "";

            // Prefer a compact one-word gloss when available.
            const preferred = defs.find(def => /^[a-zA-Z-]+$/u.test(def)) ?? defs[0];
            return preferred;
        })
        .filter(Boolean);

    const uniqueLabels = Array.from(new Set(senseLabels));
    const meaning = uniqueLabels
        .slice(0, 4)
        .map((label, index) => `${index + 1}. ${label}`)
        .join("\n")
        .trim();

    let kunyomi = "";
    for (const j of picked.japanese ?? []) {
        const word = String(j.word ?? "").trim();
        const reading = String(j.reading ?? "").trim();
        if (!word || !reading) continue;
        if (!word.startsWith(normalized)) continue;

        const okurigana = word.slice(normalized.length);
        if (okurigana && /^[\p{Script=Hiragana}]+$/u.test(okurigana) && reading.endsWith(okurigana)) {
            const stem = reading.slice(0, -okurigana.length);
            if (stem) {
                kunyomi = `${stem}.${okurigana}`;
                break;
            }
        }

        if (!kunyomi && /^[\p{Script=Hiragana}ー]+$/u.test(reading)) {
            kunyomi = reading;
        }
    }

    if (!meaning && !kunyomi) return null;
    return { meaning, kunyomi };
}

async function guessGlossFromTranslation(token: string, clauseTranslation: string) {
    if (!token) return summarizeClauseMeaning(clauseTranslation, token);

    const grammarFallbacks: Record<string, string> = {
        "し": "do (verb stem of する)",
        "て": "te-form connector",
        "で": "te-form connector / by / with",
        "だ": "copula (is/am/are)",
        "た": "past tense marker",
        "の": "possessive / explanatory marker",
        "ね": "sentence-ending particle (seeking agreement)",
        "よ": "sentence-ending particle (emphasis)",
        "か": "question marker",
        "を": "object marker",
        "に": "to / at / in",
        "は": "topic marker",
        "が": "subject marker",
        "と": "and / with / quote marker",
        "も": "also / too"
    };

    const normalizedToken = token.replace(/[っッ]+$/u, "").trim() || token;

    if (grammarFallbacks[normalizedToken]) {
        return grammarFallbacks[normalizedToken];
    }

    const cacheKey = `${normalizedToken}::${clauseTranslation}`;
    const cached = tokenGlossCache.get(cacheKey);
    if (cached) return cached;

    try {
        const jisho = await lookupJishoWordInfo(normalizedToken);
        if (jisho?.meaning && isUsefulTranslation(normalizedToken, jisho.meaning)) {
            const concise = firstGlossLine(jisho.meaning) || jisho.meaning;
            tokenGlossCache.set(cacheKey, concise);
            return concise;
        }
    } catch { }

    try {
        const result = await translate("received", normalizedToken);
        const translated = (result.text || "").trim();
        if (isUsefulTranslation(normalizedToken, translated)) {
            tokenGlossCache.set(cacheKey, translated);
            return translated;
        }
    } catch { }

    try {
        const quoted = await translate("received", `「${normalizedToken}」`);
        const translated = (quoted.text || "").trim();
        if (isUsefulTranslation(normalizedToken, translated)) {
            tokenGlossCache.set(cacheKey, translated);
            return translated;
        }
    } catch { }

    const fallback = summarizeClauseMeaning(clauseTranslation, normalizedToken);
    tokenGlossCache.set(cacheKey, fallback);
    return fallback;
}

async function buildGlosses(tokens: string[], clauseTranslation: string) {
    const rough = mergeJapaneseTokens(tokens).flatMap(splitGlossToken);
    return Promise.all(rough.map(async item => {
        if (item.gloss) return item;
        return {
            surface: item.surface,
            gloss: await guessGlossFromTranslation(item.surface, clauseTranslation)
        };
    }));
}

const LookupPreviewModal = ErrorBoundary.wrap(function LookupPreviewModal({ modalProps, text, mode, message }: { modalProps: RenderModalProps; text: string; mode: string; message?: Message; }) {
    const [fullTranslation, setFullTranslation] = useState<string>("");
    const [clauseBreakdown, setClauseBreakdown] = useState<ClauseBreakdown[]>([]);
    const [error, setError] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [imageStatus, setImageStatus] = useState<"idle" | "loading" | "ready" | "none">("idle");
    const [cachedImageHtml, setCachedImageHtml] = useState<string>("");
    const [cachedImageContextKey, setCachedImageContextKey] = useState<string>("");
    const [addingKey, setAddingKey] = useState<string | null>(null);
    const [chipStatus, setChipStatus] = useState<Record<string, "added" | "duplicate" | "error">>({});
    const [duplicateNoteIdByKey, setDuplicateNoteIdByKey] = useState<Record<string, number>>({});
    const [clauseTabs, setClauseTabs] = useState<Record<number, "words" | "grammar" | "kanji">>({});
    const [kanjiDetailsByChar, setKanjiDetailsByChar] = useState<Record<string, {
        meaning: string;
        kunyomi: string;
        onyomi: string;
    }>>({});

    const showBreakdown = shouldShowBreakdown(text);
    const imageContextKey = `${message?.id ?? "no-message"}::${text.trim()}`;

    const statusSuffix = (key: string) => {
        const status = chipStatus[key];
        if (status === "added") return " ✓";
        if (status === "duplicate") return " (dup)";
        if (status === "error") return " !";
        return "";
    };

    const statusLabel = (key: string, idleLabel = "+") => {
        const status = chipStatus[key];
        if (status === "added") return "✓";
        if (status === "duplicate") return "dup";
        if (status === "error") return "!";
        return idleLabel;
    };

    const statusChipStyle = (key: string) => {
        const status = chipStatus[key];
        if (status === "added") {
            return {
                borderColor: "rgba(87, 242, 135, 0.55)",
                background: "rgba(87, 242, 135, 0.12)",
                color: "rgb(166, 255, 196)"
            } as const;
        }

        if (status === "duplicate") {
            return {
                borderColor: "rgba(254, 231, 92, 0.55)",
                background: "rgba(254, 231, 92, 0.12)",
                color: "rgb(255, 241, 153)"
            } as const;
        }

        if (status === "error") {
            return {
                borderColor: "rgba(237, 66, 69, 0.55)",
                background: "rgba(237, 66, 69, 0.12)",
                color: "rgb(255, 176, 178)"
            } as const;
        }

        return {};
    };

    const openDuplicateInAnki = async (key: string) => {
        const noteId = duplicateNoteIdByKey[key];
        if (!noteId) return;

        try {
            await callAnkiConnect<number[]>("guiBrowse", { query: `nid:${noteId}` });
            showToast({ text: "YomiCord: Opened in Anki Browser", variant: "success" });
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            showToast({ text: `YomiCord: Could not open duplicate (${message})`, variant: "critical" });
        }
    };

    const renderDuplicateOpenButton = (key: string) => {
        const noteId = duplicateNoteIdByKey[key];
        if (!noteId || (chipStatus[key] !== "duplicate" && chipStatus[key] !== "added")) return null;

        return (
            <button
                style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    borderRadius: 999,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--background-tertiary)",
                    color: "var(--text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer"
                }}
                title={chipStatus[key] === "added" ? "View in Anki Browser" : "Open duplicate in Anki Browser"}
                onClick={() => void openDuplicateInAnki(key)}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14 5H19V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 14L19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M19 14V18C19 18.55 18.55 19 18 19H6C5.45 19 5 18.55 5 18V6C5 5.45 5.45 5 6 5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
        );
    };

    const resolveClauseTab = (index: number, hasGrammar: boolean, hasKanji: boolean) => {
        const selected = clauseTabs[index];
        if (!selected) return "words" as const;
        if (selected === "grammar" && !hasGrammar) return hasKanji ? "kanji" : "words";
        if (selected === "kanji" && !hasKanji) return hasGrammar ? "grammar" : "words";
        return selected;
    };

    useEffect(() => {
        let cancelled = false;
        const contextKey = imageContextKey;

        const preloadImage = async () => {
            if (!settings.store.autoAttachImage) {
                if (!cancelled) {
                    setCachedImageHtml("");
                    setCachedImageContextKey("");
                    setImageStatus("idle");
                }
                return;
            }

            if (!cancelled) {
                // Clear previous lookup image immediately to avoid stale reuse while loading.
                setCachedImageHtml("");
                setCachedImageContextKey(contextKey);
                setImageStatus("loading");
            }

            const imageHtml = await resolveAutoImageHtml(message);
            if (cancelled) return;

            setCachedImageHtml(imageHtml);
            setCachedImageContextKey(contextKey);
            setImageStatus(imageHtml ? "ready" : "none");
        };

        void preloadImage();

        return () => {
            cancelled = true;
        };
    }, [imageContextKey, message, text]);

    const addSelectionToAnki = async (
        selection: string,
        meaning: string,
        sourceSentence: string,
        key: string,
        forcedType: "auto" | AnkiCardType = "auto",
        translation = ""
    ) => {
        const normalized = selection.trim();
        if (!normalized) return;

        let duplicateLookupDeck = "";
        let duplicateLookupModel = "";

        try {
            setAddingKey(key);
            let imageHtml = "";
            if (settings.store.autoAttachImage) {
                imageHtml = cachedImageContextKey === imageContextKey ? cachedImageHtml : "";
                if (!imageHtml) {
                    setImageStatus("loading");
                    imageHtml = await resolveAutoImageHtml(message);
                    setCachedImageHtml(imageHtml);
                    setCachedImageContextKey(imageContextKey);
                    setImageStatus(imageHtml ? "ready" : "none");
                }
            }

            const targetType = forcedType === "auto"
                ? (isSingleKanji(normalized) ? "kanji" : "term")
                : forcedType;

            if (targetType === "kanji") {
                duplicateLookupDeck = settings.store.ankiKanjiDeck;
                duplicateLookupModel = settings.store.ankiKanjiModelName;
                const kanjiNoteId = await addKanjiToAnki(
                    normalized,
                    meaning,
                    sourceSentence,
                    translation,
                    imageHtml,
                    duplicateLookupDeck,
                    duplicateLookupModel,
                    settings.store.ankiKanjiFieldMap
                );
                setChipStatus(prev => ({ ...prev, [key]: "added" }));
                setDuplicateNoteIdByKey(prev => ({ ...prev, [key]: kanjiNoteId }));
                showToast({ text: `YomiCord: Added kanji ${normalized}`, variant: "success" });
            } else {
                const deckName = targetType === "grammar"
                    ? settings.store.ankiGrammarDeck
                    : targetType === "sentence"
                        ? settings.store.ankiSentenceDeck
                        : settings.store.ankiWordDeck;
                const modelName = targetType === "grammar"
                    ? settings.store.ankiGrammarModelName
                    : targetType === "sentence"
                        ? settings.store.ankiSentenceModelName
                        : settings.store.ankiWordModelName;
                const fieldMap = targetType === "grammar"
                    ? settings.store.ankiGrammarFieldMap
                    : targetType === "sentence"
                        ? settings.store.ankiSentenceFieldMap
                        : settings.store.ankiWordFieldMap;
                const tags = targetType === "grammar"
                    ? ["yomicord", "grammar"]
                    : targetType === "sentence"
                        ? ["yomicord", "sentence"]
                        : ["yomicord", "term"];

                duplicateLookupDeck = deckName;
                duplicateLookupModel = modelName;

                const termNoteId = await addTermToAnki(normalized, meaning, sourceSentence, translation, imageHtml, deckName, modelName, fieldMap, targetType, tags);
                setChipStatus(prev => ({ ...prev, [key]: "added" }));
                setDuplicateNoteIdByKey(prev => ({ ...prev, [key]: termNoteId }));
                showToast({ text: `YomiCord: Added term ${normalized}`, variant: "success" });
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            const isDuplicate = message.toLowerCase().includes("duplicate");
            setChipStatus(prev => ({ ...prev, [key]: isDuplicate ? "duplicate" : "error" }));
            if (isDuplicate) {
                const duplicateNoteId = await findExistingDuplicateNoteId(normalized, sourceSentence, duplicateLookupDeck, duplicateLookupModel);
                if (duplicateNoteId) {
                    setDuplicateNoteIdByKey(prev => ({ ...prev, [key]: duplicateNoteId }));
                }
                showToast({ text: "YomiCord: Already in Anki (duplicate)", variant: "success" });
            } else {
                setDuplicateNoteIdByKey(prev => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                showToast({ text: `YomiCord: Failed to add to Anki (${message})`, variant: "critical" });
            }
        } finally {
            setAddingKey(null);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            if (mode === "kanji") return;

            setIsLoading(true);
            setError("");

            try {
                const full = await translate("received", text);
                if (!cancelled) {
                    setFullTranslation(full.text);
                }

                if (!showBreakdown) return;

                const clauses = splitIntoClauses(text);
                const translatedClauses = await Promise.all(clauses.map(async source => {
                    const tokens = tokenizeJapanese(source);
                    const result = await translate("received", source);
                    return {
                        source,
                        translation: result.text,
                        tokens: mergeJapaneseTokens(tokens),
                        glosses: await buildGlosses(tokens, result.text)
                    };
                }));

                if (!cancelled) {
                    setClauseBreakdown(translatedClauses);
                }
            } catch (cause) {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [mode, showBreakdown, text]);

    useEffect(() => {
        let cancelled = false;

        const loadKanjiDetails = async () => {
            if (!showBreakdown || mode === "kanji" || clauseBreakdown.length === 0) return;

            const uniqueChars = new Set<string>();
            for (const segment of clauseBreakdown) {
                for (const entry of extractKanjiContext(segment.tokens)) {
                    uniqueChars.add(entry.kanji);
                }
            }

            const pending = Array.from(uniqueChars).filter(char => !kanjiDetailsByChar[char]);
            if (!pending.length) return;

            await Promise.all(pending.map(async char => {
                let jishoMeaning = "";
                let jishoKunyomi = "";
                let kunyomi = "";
                let onyomi = "";
                let keywords = "";

                try {
                    const jisho = await lookupJishoKanjiCardInfo(char);
                    jishoMeaning = jisho?.meaning ?? "";
                    jishoKunyomi = jisho?.kunyomi ?? "";
                } catch { }

                try {
                    const info = await lookupKanjiInfo(char);
                    kunyomi = info?.kunyomi ?? "";
                    onyomi = info?.onyomi ?? "";
                    keywords = info?.keywords ?? "";
                } catch { }

                const keywordMeaning = keywords
                    .split(",")
                    .map(entry => entry.trim())
                    .filter(Boolean)
                    .slice(0, 6)
                    .map((entry, index) => `${index + 1}. ${entry}`)
                    .join("\n")
                    .trim();

                const meaning = [jishoMeaning, keywordMeaning]
                    .map(value => value.trim())
                    .find(value => value.length > 0) ?? "";

                const details = {
                    meaning: toMultilineMeaning(meaning),
                    kunyomi: jishoKunyomi || kunyomi,
                    onyomi
                };

                if (cancelled) return;
                setKanjiDetailsByChar(prev => ({
                    ...prev,
                    [char]: details
                }));
            }));
        };

        void loadKanjiDetails();

        return () => {
            cancelled = true;
        };
    }, [clauseBreakdown, kanjiDetailsByChar, mode, showBreakdown]);

    const singleLookupKey = "single-lookup";
    const singleLookupMeaning = (fullTranslation || "").trim() || text;
    const showInlineLookupAdd = !showBreakdown;

    return (
        <Modal
            {...modalProps}
            title="YomiCord"
            subtitle={showBreakdown ? "Lookup and sentence breakdown" : "Lookup preview"}
            actions={[
                {
                    text: "Close",
                    variant: "primary",
                    onClick: modalProps.onClose
                }
            ]}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <style>{`@keyframes vcYomiTabIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                <section>
                    <div
                        style={{
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 8,
                            padding: 12,
                            background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)) var(--background-secondary)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 10
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.2 }}>Input</div>
                        <div style={{ display: "flex", justifyContent: showInlineLookupAdd ? "space-between" : "flex-start", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, color: "var(--text-normal)" }}>{text}</div>
                            {showInlineLookupAdd && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <button
                                        style={{
                                            minWidth: 22,
                                            height: 22,
                                            padding: "0 6px",
                                            borderRadius: 999,
                                            border: "1px solid var(--border-subtle)",
                                            background: "var(--background-tertiary)",
                                            color: "var(--text-normal)",
                                            cursor: "pointer",
                                            fontWeight: 700,
                                            fontSize: 11,
                                            lineHeight: 1,
                                            ...statusChipStyle(singleLookupKey)
                                        }}
                                        title="Add this lookup to Anki"
                                        disabled={addingKey === singleLookupKey}
                                        onClick={() => void addSelectionToAnki(
                                            text,
                                            singleLookupMeaning,
                                            text,
                                            singleLookupKey,
                                            mode === "kanji" ? "kanji" : "term",
                                            fullTranslation || ""
                                        )}
                                    >
                                        {addingKey === singleLookupKey ? "…" : statusLabel(singleLookupKey)}
                                    </button>
                                    {renderDuplicateOpenButton(singleLookupKey)}
                                </div>
                            )}
                        </div>

                        {mode !== "kanji" && (
                            <>
                                <div style={{ borderTop: "1px solid var(--border-subtle)", opacity: 0.8 }} />
                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.2 }}>Meaning</div>
                                <div style={{ color: "var(--text-normal)", fontSize: 13, lineHeight: 1.4 }}>
                                    {isLoading && !fullTranslation ? "Translating..." : fullTranslation || "No translation yet."}
                                </div>
                            </>
                        )}

                        {settings.store.autoAttachImage && imageStatus === "none" && (
                            <div
                                style={{
                                    color: "var(--text-muted)",
                                    fontSize: 11,
                                    opacity: 0.8
                                }}
                            >
                                No image detected. Card will still save normally.
                            </div>
                        )}
                    </div>
                </section>

                {showBreakdown && mode !== "kanji" && (
                    <section>
                        <Heading tag="h3">Breakdown</Heading>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {clauseBreakdown.map((segment, index) => {
                                const segmentGrammarPoints = extractSegmentGrammarPoints(segment);
                                const kanjiContext = extractKanjiContext(segment.tokens);
                                const grammarSurfaces = new Set(segmentGrammarPoints.map(entry => entry.surface));
                                const vocabGlosses = segment.glosses
                                    .filter(entry => !grammarSurfaces.has(entry.surface))
                                    .filter(entry => entry.gloss.trim().length > 0);
                                const uniqueVocabGlosses = vocabGlosses.filter((entry, vocabIndex, arr) => {
                                    return arr.findIndex(candidate => candidate.surface === entry.surface && candidate.gloss === entry.gloss) === vocabIndex;
                                });
                                const isSingleWordClause = segment.tokens.length <= 1;
                                const allWordMeaningRows = [
                                    ...uniqueVocabGlosses.map(entry => ({
                                        kind: "vocab" as const,
                                        surface: entry.surface,
                                        meaning: entry.gloss,
                                        pillLabel: entry.surface,
                                        ankiValue: entry.surface
                                    })),
                                    ...segmentGrammarPoints.map(entry => ({
                                        kind: "grammar" as const,
                                        surface: entry.surface,
                                        meaning: entry.explanation,
                                        pillLabel: entry.surface,
                                        ankiValue: entry.surface
                                    }))
                                ].filter((entry, rowIndex, arr) => {
                                    return arr.findIndex(candidate => candidate.kind === entry.kind && candidate.surface === entry.surface && candidate.meaning === entry.meaning) === rowIndex;
                                });
                                const tab = isSingleWordClause
                                    ? "words"
                                    : resolveClauseTab(index, segmentGrammarPoints.length > 0, kanjiContext.length > 0);

                                return <div
                                    key={`${segment.source}-${index}`}
                                    style={{
                                        border: "1px solid var(--border-subtle)",
                                        borderRadius: 8,
                                        padding: 10,
                                        background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0)) var(--background-secondary)"
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                                        <div style={{ fontWeight: 600, lineHeight: 1.3, fontSize: 14 }}>{segment.source}</div>
                                        {(() => {
                                            const clauseKey = `clause-${index}`;

                                            return (
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <button
                                                style={{
                                                    minWidth: 22,
                                                    height: 22,
                                                    padding: "0 6px",
                                                    borderRadius: 999,
                                                    border: "1px solid var(--border-subtle)",
                                                    background: "var(--background-tertiary)",
                                                    color: "var(--text-normal)",
                                                    cursor: "pointer",
                                                    fontWeight: 700,
                                                    fontSize: 11,
                                                    lineHeight: 1,
                                                    ...statusChipStyle(clauseKey)
                                                }}
                                                title="Add this clause to Anki"
                                                disabled={addingKey === clauseKey}
                                                onClick={() => void addSelectionToAnki(
                                                    segment.source,
                                                    segment.translation || fullTranslation || "",
                                                    segment.source,
                                                    clauseKey,
                                                    "sentence",
                                                    segment.translation || fullTranslation || ""
                                                )}
                                            >
                                                {addingKey === clauseKey ? "…" : statusLabel(clauseKey)}
                                            </button>
                                            {renderDuplicateOpenButton(clauseKey)}
                                        </div>
                                            );
                                        })()}
                                    </div>
                                    <div style={{ color: "var(--text-normal)", fontSize: 13, lineHeight: 1.35, opacity: 0.9 }}>{segment.translation}</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                                        <button
                                            style={{
                                                ...SECTION_TAB_STYLE,
                                                color: tab === "words" ? "var(--text-normal)" : "var(--text-muted)",
                                                borderColor: tab === "words" ? "var(--brand-500)" : "var(--border-subtle)"
                                            }}
                                            onClick={() => setClauseTabs(prev => ({ ...prev, [index]: "words" }))}
                                        >
                                            Words
                                        </button>
                                        {!isSingleWordClause && segmentGrammarPoints.length > 0 && (
                                            <button
                                                style={{
                                                    ...SECTION_TAB_STYLE,
                                                    color: tab === "grammar" ? "var(--text-normal)" : "var(--text-muted)",
                                                    borderColor: tab === "grammar" ? "var(--brand-500)" : "var(--border-subtle)"
                                                }}
                                                onClick={() => setClauseTabs(prev => ({ ...prev, [index]: "grammar" }))}
                                            >
                                                Grammar ({segmentGrammarPoints.length})
                                            </button>
                                        )}
                                        {!isSingleWordClause && kanjiContext.length > 0 && (
                                            <button
                                                style={{
                                                    ...SECTION_TAB_STYLE,
                                                    color: tab === "kanji" ? "var(--text-normal)" : "var(--text-muted)",
                                                    borderColor: tab === "kanji" ? "var(--brand-500)" : "var(--border-subtle)"
                                                }}
                                                onClick={() => setClauseTabs(prev => ({ ...prev, [index]: "kanji" }))}
                                            >
                                                Kanji ({kanjiContext.length})
                                            </button>
                                        )}
                                    </div>

                                    {tab === "words" && (
                                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto", paddingRight: 2, animation: "vcYomiTabIn 140ms ease" }}>
                                            {allWordMeaningRows.length > 0 && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    {allWordMeaningRows.map((entry, rowIndex) => (
                                                        <div key={`${entry.surface}-${entry.meaning}-${rowIndex}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                            <button
                                                                style={{ ...BASE_CHIP_STYLE, ...statusChipStyle(`word-row-${index}-${rowIndex}`), fontWeight: 700 }}
                                                                title="Add this item to Anki"
                                                                disabled={addingKey === `word-row-${index}-${rowIndex}`}
                                                                onClick={() => void addSelectionToAnki(
                                                                    entry.ankiValue,
                                                                    entry.meaning,
                                                                    segment.source,
                                                                    `word-row-${index}-${rowIndex}`,
                                                                    entry.kind === "grammar" ? "grammar" : "term",
                                                                    segment.translation || fullTranslation || ""
                                                                )}
                                                            >
                                                                {addingKey === `word-row-${index}-${rowIndex}`
                                                                    ? `${entry.pillLabel}…`
                                                                    : `${entry.pillLabel}${statusSuffix(`word-row-${index}-${rowIndex}`)}`}
                                                            </button>
                                                            {renderDuplicateOpenButton(`word-row-${index}-${rowIndex}`)}
                                                            <div
                                                                title={entry.meaning}
                                                                style={{
                                                                    color: "var(--text-muted)",
                                                                    fontSize: 11,
                                                                    lineHeight: 1.3,
                                                                    maxHeight: "2.6em",
                                                                    overflow: "hidden"
                                                                }}
                                                            >
                                                                {entry.meaning}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {allWordMeaningRows.length === 0 && (
                                                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                                                    No meaning rows in this clause.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {tab === "grammar" && (
                                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 170, overflowY: "auto", paddingRight: 2, animation: "vcYomiTabIn 140ms ease" }}>
                                            {segmentGrammarPoints.length > 0 && segmentGrammarPoints.map((entry, grammarIndex) => (
                                                <div key={`${entry.surface}-${entry.point}-${grammarIndex}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                    <button
                                                        style={{
                                                            ...BASE_CHIP_STYLE,
                                                            ...statusChipStyle(`grammar-${index}-${grammarIndex}`),
                                                            fontWeight: 700
                                                        }}
                                                        title={`${entry.point}: ${entry.explanation}`}
                                                        disabled={addingKey === `grammar-${index}-${grammarIndex}`}
                                                        onClick={() => void addSelectionToAnki(
                                                            entry.surface,
                                                            formatGrammarNoteMeaning(entry),
                                                            entry.source,
                                                            `grammar-${index}-${grammarIndex}`,
                                                            "grammar",
                                                            entry.translation || segment.translation || fullTranslation || ""
                                                        )}
                                                    >
                                                        {addingKey === `grammar-${index}-${grammarIndex}`
                                                            ? `${entry.surface}…`
                                                            : `${entry.surface}${statusSuffix(`grammar-${index}-${grammarIndex}`)}`}
                                                    </button>
                                                        {renderDuplicateOpenButton(`grammar-${index}-${grammarIndex}`)}
                                                        <div
                                                            title={entry.explanation}
                                                            style={{
                                                                color: "var(--text-muted)",
                                                                fontSize: 11,
                                                                lineHeight: 1.3,
                                                                maxHeight: "2.6em",
                                                                overflow: "hidden"
                                                            }}
                                                        >
                                                            {entry.explanation}
                                                        </div>
                                                </div>
                                            ))}
                                            {segmentGrammarPoints.length === 0 && (
                                                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                                                    No grammar notes in this clause.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {tab === "kanji" && (
                                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto", paddingRight: 2, animation: "vcYomiTabIn 140ms ease" }}>
                                            {kanjiContext.length > 0 && kanjiContext.map((entry, kanjiIndex) => (
                                                <div key={`${entry.kanji}-${kanjiIndex}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                        <button
                                                            style={{ ...BASE_CHIP_STYLE, ...statusChipStyle(`kanji-${index}-${kanjiIndex}`), fontWeight: 700 }}
                                                            title="Add this kanji to Anki"
                                                            disabled={addingKey === `kanji-${index}-${kanjiIndex}`}
                                                            onClick={() => void addSelectionToAnki(
                                                                entry.kanji,
                                                                segment.translation || fullTranslation || "",
                                                                segment.source,
                                                                `kanji-${index}-${kanjiIndex}`,
                                                                "kanji",
                                                                segment.translation || fullTranslation || ""
                                                            )}
                                                        >
                                                            {addingKey === `kanji-${index}-${kanjiIndex}` ? `${entry.kanji}…` : `${entry.kanji}${statusSuffix(`kanji-${index}-${kanjiIndex}`)}`}
                                                        </button>
                                                        {renderDuplicateOpenButton(`kanji-${index}-${kanjiIndex}`)}
                                                    </div>
                                                    <details style={{ marginTop: 2 }}>
                                                        <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 11 }}>
                                                            Meaning
                                                        </summary>
                                                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                                                            <div style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                                                                {kanjiDetailsByChar[entry.kanji]?.meaning || "Meaning: loading..."}
                                                            </div>
                                                            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                                                                Kun: {kanjiDetailsByChar[entry.kanji]?.kunyomi || "-"}
                                                            </div>
                                                            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                                                                On: {kanjiDetailsByChar[entry.kanji]?.onyomi || "-"}
                                                            </div>
                                                        </div>
                                                    </details>
                                                </div>
                                            ))}
                                            {kanjiContext.length === 0 && (
                                                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                                                    No kanji picks in this clause.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>;
                            })}
                            {isLoading && clauseBreakdown.length === 0 && <div>Breaking it down...</div>}
                        </div>
                    </section>
                )}

                {error && (
                    <section>
                        <Heading tag="h3">Translation Error</Heading>
                        <div>{error}</div>
                    </section>
                )}
            </div>
        </Modal>
    );
}, { noop: false });

function openLookupPreviewModal(text: string, mode: string, message?: Message) {
    openModal((modalProps: RenderModalProps) => (
        <LookupPreviewModal modalProps={modalProps} text={text} mode={mode} message={message} />
    ));
}

// ----- Anki Card Miner: the app does the breakdown and makes the cards, so they match anime and game cards -----

const MINER = {
    accent: "#7aa2ff", green: "#3ecf8e", muted: "#8f96a6", line: "rgba(255,255,255,0.08)", box: "rgba(255,255,255,0.03)",
    mark: "#2c3a5c", markText: "#cfdcff", red: "#ff7a7a"
};

function cardMinerPayload(text: string, message: Message) {
    const channel = ChannelStore.getChannel(message.channel_id);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const author = message.author as any;
    return {
        text,
        message: sanitizeLookupText(message.content ?? ""),
        author: author?.globalName || author?.global_name || author?.username || "",
        avatar: author?.avatar ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128` : "",
        channel: channel?.name || (channel ? "Direct message" : ""),
        server: guild?.name || "",
        id: message.id,
        time: new Date(message.timestamp as any).getTime() / 1000 || Date.now() / 1000
    };
}

// Asks the app something. Returns null when the app isn't open.
async function askCardMiner(path: string, body: any): Promise<any | null> {
    const answer = await Native.callCardMiner(path, JSON.stringify(body));
    if (!answer) return null;
    try {
        return JSON.parse(answer);
    } catch {
        return null;
    }
}

const MINER_LABEL: Record<string, [string, string]> = {
    "in": ["in Anki", MINER.green], new: ["new", MINER.accent], known: ["known", MINER.muted], grammar: ["grammar", MINER.muted]
};

function rowState(row: any): string {
    const option = row.options?.[0];
    if (!option) return "known";
    if (option.deck) return "in";
    if (option.known) return "known";
    if (option.grammar) return "grammar";
    return "new";
}

function minerButton(primary = false): React.CSSProperties {
    return {
        border: `1px solid ${primary ? MINER.accent : MINER.line}`, background: primary ? MINER.accent : "transparent",
        color: primary ? "#0d1222" : "var(--text-normal)", borderRadius: 8, padding: "4px 12px", fontSize: 13,
        fontWeight: primary ? 700 : 500, cursor: "pointer"
    };
}

const CardMinerModal = ErrorBoundary.wrap(function CardMinerModal({ modalProps, data, message, text }: { modalProps: RenderModalProps; data: any; message: Message; text: string; }) {
    const [view, setView] = useState<"words" | "grammar">("words");
    const [onlyNew, setOnlyNew] = useState(false);
    const [added, setAdded] = useState<Record<string, string>>({});
    const [hovered, setHovered] = useState<string>("");
    const [showTranslation, setShowTranslation] = useState(false);
    const [grammar, setGrammar] = useState<any[] | null>(null);
    const [grammarState, setGrammarState] = useState<string>("");

    const payload = cardMinerPayload(text, message);
    const where = payload.channel && payload.channel !== "Direct message"
        ? `${payload.author} · #${payload.channel}${payload.server ? ` · ${payload.server}` : ""}` : payload.author;
    const rows: any[] = data.rows || [];
    const newCount = rows.filter(r => rowState(r) === "new").length;
    const shownRows = rows.filter(r => !onlyNew || rowState(r) === "new");

    async function addWord(row: any) {
        const option = { ...row.options[0], surface: row.text };
        setAdded(a => ({ ...a, [row.text]: "Adding…" }));
        const result = await askCardMiner("/discord/add", { file: data.file, option });
        if (!result || result.error) {
            setAdded(a => ({ ...a, [row.text]: "" }));
            showToast({ text: `YomiCord: ${result?.error || "Anki Card Miner isn't open"}`, variant: "critical" });
            return;
        }
        setAdded(a => ({ ...a, [row.text]: "Added" }));
        showToast({ text: `YomiCord: Added ${result.word} to ${result.deck}`, variant: "success" });
    }

    async function loadGrammar() {
        setGrammarState("Asking Claude…");
        const result = await askCardMiner("/discord/grammar", { file: data.file });
        if (!result || result.error) { setGrammarState(result?.error || "Anki Card Miner isn't open"); return; }
        setGrammar(result.points || []);
        setGrammarState("");
    }

    async function addGrammar(point: any) {
        setAdded(a => ({ ...a, ["g:" + point.pattern]: "Adding…" }));
        const result = await askCardMiner("/discord/add", { file: data.file, point });
        if (!result || result.error) {
            setAdded(a => ({ ...a, ["g:" + point.pattern]: "" }));
            showToast({ text: `YomiCord: ${result?.error || "Anki Card Miner isn't open"}`, variant: "critical" });
            return;
        }
        setAdded(a => ({ ...a, ["g:" + point.pattern]: "Added" }));
    }

    // The word under the pointer gets the same soft box as on the cards.
    const sentence: string = data.sentence || text;
    const at = hovered ? sentence.indexOf(hovered) : -1;
    const sentenceView = at < 0 ? sentence : <>
        {sentence.slice(0, at)}
        <span style={{ background: MINER.mark, color: MINER.markText, borderRadius: 6, padding: "1px 5px" }}>{hovered}</span>
        {sentence.slice(at + hovered.length)}
    </>;

    const tab = (key: "words" | "grammar", label: string) => (
        <button onClick={() => setView(key)} style={{
            border: 0, background: "none", padding: "6px 2px", marginRight: 18, cursor: "pointer", fontSize: 14,
            color: view === key ? "var(--text-normal)" : MINER.muted, fontWeight: view === key ? 600 : 500,
            borderBottom: `2px solid ${view === key ? MINER.accent : "transparent"}`
        }}>{label}</button>
    );

    const status = (label: string, color: string) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />{label}
        </span>
    );

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="YomiCord"
            subtitle={where || "Discord"}
            actionBarInput={<span style={{ fontSize: 12, color: MINER.muted }}>New cards go to {data.deck}</span>}
            actions={[
                { text: "Classic view", variant: "secondary", onClick: () => { modalProps.onClose(); openLookupPreviewModal(text, detectLookupMode(text), message); } },
                { text: "Close", variant: "primary", onClick: modalProps.onClose }
            ]}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 6 }}>
                <div style={{ background: MINER.box, border: `1px solid ${MINER.line}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div lang="ja" style={{ fontSize: 26, lineHeight: 1.7, color: "var(--text-normal)" }}>{sentenceView}</div>
                    <div
                        onMouseEnter={() => setShowTranslation(true)}
                        onMouseLeave={() => setShowTranslation(false)}
                        style={{
                            borderTop: `1px solid ${MINER.line}`, paddingTop: 10, fontSize: 14, lineHeight: 1.5,
                            color: showTranslation ? "var(--text-normal)" : MINER.muted, cursor: "default"
                        }}
                    >
                        {showTranslation ? (data.translation || "Couldn't get a translation.") : "Hover to see the translation"}
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${MINER.line}` }}>
                    {tab("words", "Words")}
                    {tab("grammar", "Grammar")}
                    {view === "words" && <>
                        <span style={{ marginLeft: "auto", fontSize: 12.5, color: MINER.muted, marginRight: 10 }}>{newCount} new of {rows.length}</span>
                        <button onClick={() => setOnlyNew(!onlyNew)} style={{
                            border: `1px solid ${onlyNew ? MINER.accent : MINER.line}`, background: onlyNew ? "rgba(122,162,255,0.12)" : "transparent",
                            color: onlyNew ? MINER.accent : MINER.muted, borderRadius: 999, padding: "3px 12px", fontSize: 12.5, cursor: "pointer", marginBottom: 4
                        }}>New only</button>
                    </>}
                </div>

                {view === "words" && <div lang="ja" style={{ display: "flex", flexDirection: "column" }}>
                    {shownRows.map(row => {
                        const option = row.options?.[0];
                        const state = rowState(row);
                        const [label, color] = MINER_LABEL[state];
                        const quiet = state === "grammar" || (state === "known" && !option?.deck);
                        const meaning = option?.senses?.[0]?.gloss?.slice(0, 4).join("; ") || "";
                        const done = added[row.text];
                        return (
                            <div key={row.text + (option?.word || "")}
                                onMouseEnter={() => setHovered(row.text)} onMouseLeave={() => setHovered("")}
                                style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14, alignItems: "center",
                                    padding: quiet ? "8px 10px" : "12px 10px", borderRadius: 10,
                                    background: hovered === row.text ? MINER.box : "transparent"
                                }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                                        <b style={{ fontSize: quiet ? 16 : 21, color: quiet ? MINER.muted : "var(--text-normal)" }}>{option?.word || row.text}</b>
                                        {option?.reading && option.reading !== option.word && <span style={{ fontSize: 13, color: MINER.muted }}>{option.reading}</span>}
                                    </div>
                                    {meaning && <div lang="en" style={{ fontSize: quiet ? 12.5 : 14, color: quiet ? MINER.muted : "var(--text-normal)", lineHeight: 1.45, marginTop: 2 }}>{meaning}</div>}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    {done === "Added" ? status("added", MINER.green) : status(label, color)}
                                    {state === "new" && done !== "Added" && option &&
                                        <button style={minerButton(true)} disabled={!!done} onClick={() => addWord(row)}>{done || "Add"}</button>}
                                </div>
                            </div>
                        );
                    })}
                    {shownRows.length === 0 && <div style={{ color: MINER.muted, fontSize: 13, padding: "10px" }}>Every word here is already in Anki or known.</div>}
                </div>}

                {view === "grammar" && <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {grammar === null && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 2px" }}>
                        <button style={minerButton(true)} onClick={loadGrammar} disabled={!!grammarState}>{grammarState || "Find grammar"}</button>
                        <span style={{ fontSize: 13, color: MINER.muted }}>Claude explains the grammar in this message.</span>
                    </div>}
                    {grammar?.map(point => {
                        const done = added["g:" + point.pattern];
                        const inDeck = !!point.deck;
                        return (
                            <div key={point.pattern} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14, alignItems: "start", padding: "12px 10px", borderRadius: 10 }}>
                                <div style={{ minWidth: 0, fontSize: 14, lineHeight: 1.5 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                                        <b lang="ja" style={{ fontSize: 19, color: "var(--text-normal)" }}>{point.pattern}</b>
                                        <span style={{ color: "var(--text-normal)" }}>{point.meaning}</span>
                                    </div>
                                    <div style={{ color: MINER.muted, marginTop: 3 }}>{point.explanation}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    {inDeck ? status("in Anki", MINER.green) : done === "Added" ? status("added", MINER.green) : status("new", MINER.accent)}
                                    {!inDeck && done !== "Added" &&
                                        <button style={minerButton(true)} disabled={!!done} onClick={() => addGrammar(point)}>{done || "Add"}</button>}
                                </div>
                            </div>
                        );
                    })}
                    {grammar?.length === 0 && <div style={{ color: MINER.muted, fontSize: 13, padding: "10px" }}>No grammar points found.</div>}
                    {grammar !== null && grammarState && <div style={{ color: MINER.red, fontSize: 13 }}>{grammarState}</div>}
                </div>}
            </div>
        </Modal>
    );
}, { noop: false });

function openCardMinerModal(data: any, message: Message, text: string) {
    openModal((modalProps: RenderModalProps) => (
        <CardMinerModal modalProps={modalProps} data={data} message={message} text={text} />
    ));
}

// Look up: the app breaks it down when it's open; otherwise YomiCord's own lookup, as before.
async function lookUp(text: string, message: Message) {
    const data = await askCardMiner("/discord/lookup", cardMinerPayload(text, message));
    if (data && !data.error) {
        openCardMinerModal(data, message, text);
        return;
    }
    if (data?.error) showToast({ text: `YomiCord: ${data.error}`, variant: "critical" });
    openLookupPreviewModal(text, detectLookupMode(text), message);
}

const messageContextPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const selectedText = getSelectedLookupText(message);
    if (!selectedText) return;

    if (!message?.author) return;

    const group = findGroupChildrenByChildId("copy-text", children) ?? children;
    const insertIndex = Array.isArray(group)
        ? group.findIndex(child => child?.props?.id === "copy-text") + 1
        : -1;

    const menuItems = [
        <Menu.MenuItem
            id="vc-yomicord-lookup"
            key="vc-yomicord-lookup"
            label="Look up with YomiCord"
            icon={YomiCordIcon}
            action={() => { void lookUp(selectedText, message); }}
        />
    ];

    if (insertIndex > 0) {
        group.splice(insertIndex, 0, ...menuItems);
    } else {
        group.push(...menuItems);
    }
};

export default definePlugin({
    name: "YomiCord",
    description: "Japanese lookup and Anki mining inside Discord",
    authors: [{ name: "htspider", id: 0n }],
    tags: ["Utility"],
    searchTerms: ["Japanese", "Anki"],
    settings,
    contextMenus: {
        message: messageContextPatch
    },

    commands: [
        {
            name: "yomicord",
            description: "Test YomiCord text capture and lookup routing",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "Japanese text to classify",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const text = findOption(args, "text", "").trim();

                if (!text) {
                    sendBotMessage(ctx.channel.id, {
                        content: "YomiCord: no text received."
                    });
                    return;
                }

                const mode = detectLookupMode(text);

                sendBotMessage(ctx.channel.id, {
                    content: [
                        "YomiCord test successful.",
                        `Text: ${text}`,
                        `Detected mode: ${mode}`
                    ].join("\n")
                });
            }
        }
    ]
});