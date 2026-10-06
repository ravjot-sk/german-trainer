// Starting rules per category, shown to Gemini so the rules it names line up with how
// grammar is taught: German from the Profile deutsch grammar inventory (CEFR levels),
// Japanese from the JLPT grammar lists (N levels). Gemini reuses one of these keys when a
// mistake fits it and names a new rule otherwise. Keys only ever grow: a key in use must not
// be renamed, or its mistakes lose their rule.

export const SEEDS = {
  de: {
    word_order_main: [
      ['verb_second', 'The finite verb is the second element of a main clause, also after a fronted adverb or object', 'A2'],
      ['separable_prefix_end', 'A separable prefix goes to the end of the main clause', 'A1'],
      ['satzklammer_infinitive_participle', 'Infinitives and participles go to the end of the main clause (Satzklammer)', 'A2'],
      ['tekamolo_order', 'Adverbials usually run time, cause, manner, place', 'B1'],
    ],
    word_order_sub: [
      ['verb_last_subordinate', 'In a subordinate clause the finite verb goes last', 'A2'],
      ['verb_cluster_order', 'With several verbs at the end, the finite verb comes last (… kommen konnte)', 'B1'],
      ['double_infinitive_order', 'With a double infinitive in a subordinate clause, the finite verb comes first (… hat kommen können)', 'B2'],
      ['separable_joined_subordinate', 'In a subordinate clause a separable verb is written as one word at the end', 'A2'],
    ],
    case: [
      ['accusative_object', 'The direct object is in the accusative', 'A1'],
      ['dative_verbs', 'Some verbs take a dative object (helfen, danken, gefallen, gehören)', 'A2'],
      ['two_way_prepositions', 'Two-way prepositions take accusative for direction (wohin) and dative for location (wo)', 'A2'],
      ['dative_prepositions', 'aus, bei, mit, nach, seit, von, zu always take the dative', 'A2'],
      ['genitive_prepositions', 'wegen, trotz, während, statt take the genitive in written German', 'B1'],
      ['n_declension', 'Weak masculine nouns add -n/-en outside the nominative (den Kollegen)', 'B1'],
    ],
    gender: [
      ['gender_by_suffix', 'Suffixes predict gender: -ung, -heit, -keit, -schaft are feminine; -chen, -lein are neuter', 'A2'],
      ['compound_gender_last', 'A compound noun takes the gender of its last part', 'A2'],
    ],
    number: [
      ['plural_forms', 'Learn the plural with the noun; the main types are -e, -er, -(e)n, -s and umlaut', 'A1'],
      ['dative_plural_n', 'Nouns add -n in the dative plural (mit den Kindern)', 'A2'],
    ],
    adjective_endings: [
      ['adj_after_definite', 'After der/die/das the adjective ends in -e or -en', 'A2'],
      ['adj_after_indefinite', 'After ein/kein/mein the adjective shows the gender where the article does not (ein guter Wein)', 'A2'],
      ['adj_no_article', 'Without an article the adjective takes the article\'s ending (guter Wein, mit gutem Wein)', 'B1'],
      ['adj_predicative_no_ending', 'A predicative adjective after sein/werden takes no ending', 'A1'],
    ],
    articles: [
      ['no_article_professions', 'No article before professions and nationalities after sein/werden', 'A2'],
      ['article_contractions', 'Use the contracted forms im, am, zum, zur, ins where usual', 'A2'],
      ['definite_vs_indefinite', 'Known or unique things take der/die/das, new or non-specific ones ein/eine', 'A2'],
    ],
    prepositions: [
      ['verb_fixed_preposition', 'Verbs with a fixed preposition (warten auf, sich freuen auf/über, denken an)', 'B1'],
      ['adjective_fixed_preposition', 'Adjectives with a fixed preposition (stolz auf, zufrieden mit, interessiert an)', 'B1'],
      ['da_wo_compounds', 'Refer to a thing after a fixed preposition with da(r)-/wo(r)- (darauf, worüber)', 'B1'],
      ['places_in_an_auf_zu', 'Choice of preposition for places: in/an/auf/zu/nach/bei', 'A2'],
      ['time_prepositions', 'Prepositions of time: am (days), im (months), um (clock), seit, vor, nach', 'A2'],
    ],
    agreement: [
      ['subject_verb_agreement', 'The verb agrees with its subject in person and number', 'A1'],
      ['strong_verb_vowel_change', 'Strong verbs change their stem vowel in du/er forms (fährt, liest)', 'A1'],
    ],
    tense: [
      ['perfekt_spoken_praeteritum_written', 'Perfekt in speech, Präteritum in written narration; sein, haben and modals mostly in Präteritum', 'B1'],
      ['plusquamperfekt_anteriority', 'An event before another past event takes the Plusquamperfekt', 'B1'],
      ['seit_present', 'seit with an ongoing action takes the present tense', 'A2'],
    ],
    verb_complex: [
      ['perfekt_sein_movement_change', 'Verbs of movement or change of state, and passieren, bleiben, sein, werden take sein in the Perfekt', 'A2'],
      ['participle_forms', 'Participle forms: ge-…-t, ge-…-en, no ge- for -ieren and inseparable prefixes', 'A2'],
      ['zu_infinitive', 'Infinitive with zu after most verbs and nouns, without zu after modals and lassen', 'B1'],
      ['modal_double_infinitive', 'Modal verbs in the Perfekt use a double infinitive (hat kommen müssen)', 'B2'],
    ],
    mood: [
      ['konjunktiv2_wuerde', 'Konjunktiv II with würde + infinitive; hätte, wäre and modals in their own forms', 'B1'],
      ['konjunktiv2_past', 'Unreal past: hätte/wäre + participle', 'B2'],
      ['konjunktiv1_indirect_speech', 'Indirect speech in Konjunktiv I (er sei, sie habe), Konjunktiv II where the forms are equal', 'B2'],
    ],
    passive: [
      ['werden_passive', 'Process passive: werden + participle, agent with von', 'B1'],
      ['passive_perfekt_worden', 'Passive Perfekt uses worden, not geworden', 'B2'],
      ['passive_with_modal', 'Passive with a modal: muss gemacht werden', 'B2'],
      ['zustandspassiv', 'State passive: sein + participle (die Tür ist geschlossen)', 'B2'],
    ],
    valency: [
      ['reflexive_pronoun', 'Reflexive verbs need sich, in accusative or dative (ich wasche mich, ich wasche mir die Hände)', 'A2'],
      ['required_object', 'A verb\'s required object or complement must be there', 'B1'],
    ],
    connectors: [
      ['weil_denn_deshalb', 'weil sends the verb to the end, denn keeps main-clause order, deshalb takes the verb second', 'A2'],
      ['als_wenn_past', 'als for a single past event, wenn for repeated ones and the present or future', 'B1'],
      ['obwohl_trotzdem', 'obwohl (verb last) vs trotzdem (verb second)', 'B1'],
      ['damit_um_zu', 'um … zu with the same subject, damit with a different one', 'B1'],
      ['relative_pronoun_case', 'The relative pronoun takes gender and number from the noun, case from its own clause', 'B1'],
    ],
    negation: [
      ['kein_vs_nicht', 'kein negates nouns with ein or no article; nicht negates everything else', 'A1'],
      ['nicht_position', 'nicht stands before the part it negates, or near the end to negate the sentence', 'A2'],
    ],
    capitalisation: [
      ['nouns_capitalised', 'All nouns are capitalised', 'A1'],
      ['nominalised_verbs_adjectives', 'Verbs and adjectives used as nouns are capitalised (das Warten, etwas Neues)', 'B1'],
      ['paar_bisschen_lowercase', 'ein paar (some) and ein bisschen are lowercase; das Paar (a couple) is a noun', 'B1'],
      ['sie_formal_capital', 'The polite Sie, Ihnen, Ihr are capitalised', 'A1'],
    ],
    spelling: [
      ['ss_eszett', 'ß after a long vowel or diphthong, ss after a short vowel', 'A2'],
      ['compound_one_word', 'Compound nouns are written as one word', 'A2'],
    ],
    punctuation: [
      ['comma_subordinate_clause', 'A comma separates every subordinate clause from the main clause', 'A2'],
      ['comma_infinitive_group', 'A comma before an infinitive group with um, ohne, statt, or one that depends on a noun', 'B1'],
      ['comma_relative_clause', 'Relative clauses are set off by commas on both sides', 'B1'],
    ],
  },
  ja: {
    particles: [
      ['wa_vs_ga', 'は marks the topic; が marks new information, the subject of a subordinate clause, and with 好き/ある/いる/わかる', 'N4'],
      ['ni_vs_de_place', 'に for where something exists or goes; で for where an action happens', 'N5'],
      ['wo_through_from', 'を for a place passed through or left (道を歩く, 家を出る)', 'N4'],
      ['ni_target_time', 'に for points in time and for the target of an action', 'N5'],
    ],
    verb_conjugation: [
      ['te_form', 'te-form by verb group: って, んで, いて/いで, して', 'N5'],
      ['potential_form', 'Potential forms: られる / える; ichidan often drops ら in speech', 'N4'],
      ['volitional_form', 'Volitional form: よう / おう', 'N4'],
    ],
    transitivity: [
      ['transitive_pairs', 'Transitive verbs take を (ドアを開ける); intransitive ones が (ドアが開く)', 'N4'],
    ],
    aspect: [
      ['teiru_ongoing_state', 'ている is an ongoing action or a resulting state, depending on the verb', 'N4'],
      ['tearu_intended_state', 'てある is a state someone left on purpose (with transitive verbs)', 'N3'],
      ['teshimau_completion_regret', 'てしまう for completion or regret', 'N4'],
    ],
    voice: [
      ['passive_rareru', 'Passive with られる; the agent takes に', 'N4'],
      ['causative_saseru', 'Causative with させる; the person made to act takes に or を', 'N4'],
      ['causative_passive', 'Causative-passive させられる for being made to do something', 'N3'],
    ],
    adjectives: [
      ['i_adjective_past_negative', 'i-adjectives: かった, くない, くなかった (not じゃない)', 'N5'],
      ['na_adjective_forms', 'na-adjectives conjugate like nouns with だ and take な before nouns', 'N5'],
    ],
    copula: [
      ['no_da_after_i_adjective', 'No だ after an i-adjective (高いです, not 高いだ)', 'N5'],
      ['na_no_before_noun', 'な before a noun after a na-adjective, の after a noun', 'N5'],
    ],
    nominalisation: [
      ['no_vs_koto', 'の for perception and the here and now (見る, 聞く); こと with です, 好き in statements and set phrases (ことがある, ことにする)', 'N4'],
    ],
    clause_linking: [
      ['kara_vs_node', 'から for subjective reasons and requests; ので for objective, softer explanations', 'N4'],
      ['noni_contrary', 'のに for an unexpected or regretted result', 'N4'],
      ['relative_clause_no_particle', 'A relative clause goes directly before the noun, with no particle in between and が/の for its subject', 'N4'],
    ],
    conditionals: [
      ['tara_completed', 'たら for one-off conditions and after something is done', 'N4'],
      ['to_automatic', 'と for automatic or habitual results; no requests or wishes after it', 'N4'],
      ['ba_general', 'ば for general conditions; often with いい for advice', 'N4'],
      ['nara_topic', 'なら takes up what the other person said', 'N4'],
    ],
    giving_receiving: [
      ['ageru_kureru_direction', 'あげる gives away from the speaker; くれる gives towards the speaker', 'N4'],
      ['te_morau_kureru', 'てもらう / てくれる for favours, with に for the giver of てもらう', 'N4'],
    ],
    demonstratives: [
      ['ko_so_a', 'こ near the speaker, そ near the listener or just mentioned, あ far from both or shared knowledge', 'N5'],
    ],
    negation: [
      ['nakute_vs_naide', 'ないで for "without doing", なくて for a negative reason', 'N3'],
    ],
    word_order: [
      ['verb_final', 'The predicate comes at the end of the sentence', 'N5'],
      ['modifier_before_noun', 'Modifiers come before the noun they describe', 'N5'],
    ],
    politeness: [
      ['consistent_style', 'Keep one style (です/ます or plain) through a text', 'N4'],
      ['sonkeigo_kenjougo', 'Respectful forms for others\' actions, humble forms for your own', 'N3'],
    ],
    counters: [
      ['counter_choice', 'The counter depends on the object: 枚, 本, 匹, 冊, 台, 人, つ', 'N5'],
      ['counter_sound_changes', 'Sound changes with counters: いっぽん, さんぼん, ろっぽん', 'N4'],
    ],
    spelling: [
      ['okurigana', 'Okurigana: which part of a word is written in kana after the kanji', 'N3'],
      ['long_vowels_small_tsu', 'Long vowels and the small っ', 'N5'],
    ],
  },
};

// Text for a prompt: the seed rules of one language, by category.
export function seedGuide(code) {
  const s = SEEDS[code];
  if (!s) return '';
  return Object.entries(s).map(([cat, list]) =>
    `${cat}:\n${list.map(([k, en, lvl]) => `  - ${k} (${lvl}): ${en}`).join('\n')}`).join('\n');
}
