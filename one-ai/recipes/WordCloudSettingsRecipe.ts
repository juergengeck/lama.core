/**
 * Recipe for Word Cloud Settings
 *
 * Stores user preferences for word cloud visualization following the
 * same pattern as GlobalLLMSettings in the LAMA reference implementation
 */
export const WordCloudSettingsRecipe = {
    $type$: 'Recipe',
    name: 'WordCloudSettings',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^WordCloudSettings$/ }
        },
        {
            itemprop: 'creator',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'created',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'modified',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'maxWordsPerSubject',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'relatedWordThreshold',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'minWordFrequency',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'showSummaryKeywords',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'fontScaleMin',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'fontScaleMax',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'colorScheme',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'layoutDensity',
            itemtype: { type: 'string' }
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};