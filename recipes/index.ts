/**
 * Central recipe registry for lama.core
 * All ONE.core recipes that need to be registered
 */

import { LLMRecipe } from './LLMRecipe.js';
import { SubjectRecipe } from '../one-ai/recipes/SubjectRecipe.js';
import { KeywordRecipe } from '../one-ai/recipes/KeywordRecipe.js';
import { SummaryRecipe } from '../one-ai/recipes/SummaryRecipe.js';
import { WordCloudSettingsRecipe } from '../one-ai/recipes/WordCloudSettingsRecipe.js';
import { KeywordAccessStateRecipe } from '../one-ai/recipes/KeywordAccessState.js';

/**
 * All recipes that need to be registered with ONE.core
 * Pass this array to registerRecipes() during initialization
 */
export const LAMA_CORE_RECIPES = [
    LLMRecipe,
    SubjectRecipe,
    KeywordRecipe,
    SummaryRecipe,
    WordCloudSettingsRecipe,
    KeywordAccessStateRecipe
];

// Re-export individual recipes for convenience
export {
    LLMRecipe,
    SubjectRecipe,
    KeywordRecipe,
    SummaryRecipe,
    WordCloudSettingsRecipe,
    KeywordAccessStateRecipe
};
