/**
 * Central recipe registry for lama.core
 * All ONE.core recipes that need to be registered
 */

import { AIRecipe } from './AIRecipe.js';
import { LLMRecipe } from './LLMRecipe.js';
import { GlobalLLMSettingsRecipe } from './GlobalLLMSettingsRecipe.js';
import { AISettingsRecipe } from './AISettingsRecipe.js';
import { AppSettingsRecipe } from './AppSettingsRecipe.js';
import { ProposalConfigRecipe } from './ProposalConfigRecipe.js';
import { ProposalRecipe } from './ProposalRecipe.js';
import { ProposalInteractionPlanRecipe, ProposalInteractionResponseRecipe } from './ProposalInteractionRecipes.js';
import { SubjectRecipe } from '../one-ai/recipes/SubjectRecipe.js';
import { KeywordRecipe } from '../one-ai/recipes/KeywordRecipe.js';
import { SummaryRecipe } from '../one-ai/recipes/SummaryRecipe.js';
import { WordCloudSettingsRecipe } from '../one-ai/recipes/WordCloudSettingsRecipe.js';
import { KeywordAccessStateRecipe } from '../one-ai/recipes/KeywordAccessState.js';
import { FeedbackRecipe } from '../one-ai/recipes/FeedbackRecipe.js';
import { MemoryRecipe } from '@memory/core';

/**
 * All recipes that need to be registered with ONE.core
 * Pass this array to registerRecipes() during initialization
 */
export const LAMA_CORE_RECIPES = [
    AIRecipe,
    LLMRecipe,
    GlobalLLMSettingsRecipe,
    AISettingsRecipe,
    AppSettingsRecipe,
    ProposalConfigRecipe,
    ProposalRecipe,
    ProposalInteractionPlanRecipe,
    ProposalInteractionResponseRecipe,
    SubjectRecipe,
    KeywordRecipe,
    SummaryRecipe,
    WordCloudSettingsRecipe,
    KeywordAccessStateRecipe,
    FeedbackRecipe,
    MemoryRecipe
];

// Re-export individual recipes for convenience
export {
    AIRecipe,
    LLMRecipe,
    GlobalLLMSettingsRecipe,
    AISettingsRecipe,
    AppSettingsRecipe,
    ProposalConfigRecipe,
    ProposalRecipe,
    ProposalInteractionPlanRecipe,
    ProposalInteractionResponseRecipe,
    SubjectRecipe,
    KeywordRecipe,
    SummaryRecipe,
    WordCloudSettingsRecipe,
    KeywordAccessStateRecipe,
    FeedbackRecipe,
    MemoryRecipe
};
