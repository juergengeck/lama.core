# AI vs LLM Architecture Refactoring Plan

> **✅ STATUS: COMPLETED - January 2025**
>
> This refactor has been successfully completed. All components have been migrated to the Person-centric architecture. See [AI_LLM_ARCHITECTURE.md](./AI_LLM_ARCHITECTURE.md) for current implementation details.

## Executive Summary

**Goal**: Separate AI identity (who) from LLM configuration (how) using ONE.core Person/Profile/Someone pattern with Profile-based delegation.

**Approach**: Clean break migration (Option B) - single migration script converts everything at once.

**Benefits**:
- Switch models without losing AI identity/conversation history
- Support AI → AI delegation chains
- Clean separation of concerns
- Native ONE.core Person architecture for both AI and LLM

---

## Current Architecture Analysis

### Data Structures

**LLM Object** (`@OneObjectInterfaces.d.ts:162-216`):
```typescript
interface LLM {
  $type$: 'LLM';
  name: string;        // ID property
  server: string;      // ID property
  modelId: string;
  personId?: SHA256IdHash<Person>;  // ⚠️ COUPLING POINT
  // ... technical config (API keys, params, etc.)
}
```

**AIContactManager** (`lama.core/models/ai/AIContactManager.ts`):
- Creates Person/Profile/Someone for each model
- Email pattern: `${modelId}@ai.local`
- Someone.someoneId: `${modelId}` (not prefixed)
- Cache: `Map<modelId, personId>`
- Reverse: `Map<personId, modelId>`

**AITopicManager** (`lama.core/models/ai/AITopicManager.ts:27-28`):
- Registry: `Map<topicId, modelId>`
- No persistence - rebuilt on startup via `scanExistingConversations()`

### Current Flow

```
User selects model "claude-sonnet-4-5"
    ↓
AIContactManager.ensureAIContactForModel(modelId, displayName)
    ↓
Creates Person/Profile/Someone with email "${modelId}@ai.local"
    ↓
AITopicManager.registerAITopic(topicId, modelId)
    ↓
AIMessageProcessor uses modelId to get LLM config
    ↓
Lookups: modelId → personId via AIContactManager cache
```

### Coupling Points

1. **LLM.personId** - Direct link from config to identity
2. **AIContactManager** - Assumes 1:1 modelId ↔ personId
3. **AITopicManager** - Stores modelId, not personId
4. **Email pattern** - Uses modelId in email (migration concern)
5. **Someone.someoneId** - Not prefixed (can't distinguish AI vs LLM)

---

## Target Architecture

### Data Structures

**AI Person** (represents assistant identity):
```
Person: email = "${aiId}@ai.local", name = "Claude"
    ↓
Profile:
    profileId: "ai:${aiId}"  (ID property)
    delegatesTo: SHA256IdHash<Person>  ← points to LLM Person
    entityType: "ai"
    ↓
Someone:
    someoneId: "ai:${aiId}"
```

**LLM Person** (represents model identity):
```
Person: email = "${modelId}@llm.local", name = "claude-sonnet-4-5"
    ↓
Profile:
    profileId: "llm:${modelId}"  (ID property)
    provider: "anthropic"
    llmConfigId: "${name}@${server}"  ← references LLM config object
    entityType: "llm"
    ↓
Someone:
    someoneId: "llm:${modelId}"
```

**LLM Config Object** (technical details):
```typescript
interface LLM {
  $type$: 'LLM';
  name: string;
  server: string;
  modelId: string;
  // REMOVED: personId
  // ... all technical config stays
}
```

### New Flow

```
User creates AI "Claude" → delegates to "claude-sonnet-4-5"
    ↓
AIManager.createAI(aiId, name, llmPersonId)
    ↓
AI Person with Profile.delegatesTo = llmPersonId
    ↓
AITopicManager.registerAITopic(topicId, aiPersonId)
    ↓
AIMessageProcessor resolves: aiPersonId → llmPersonId
    ↓
AIManager.resolveLLMPerson(aiPersonId) follows delegation chain
    ↓
Get LLM config via Profile.llmConfigId
```

---

## Migration Strategy

### Phase 1: Pre-Migration Preparation

**Files to Create**:
1. ✅ `AIManager.ts` - New manager for AI/LLM Persons (DONE)
2. ✅ `AI_LLM_ARCHITECTURE.md` - Architecture doc (DONE)
3. 📝 `migrate-ai-llm-separation.ts` - Migration script
4. 📝 `AI_LLM_REFACTOR_PLAN.md` - This document

**Files to Update** (marked for update, not modified yet):
1. `@OneObjectInterfaces.d.ts` - Remove LLM.personId
2. `AITopicManager.ts` - Change from modelId to aiPersonId
3. `AIAssistantPlan.ts` - Replace AIContactManager with AIManager
4. `AIMessageProcessor.ts` - Add LLM resolution logic
5. `AIPromptBuilder.ts` - May need updates for resolution
6. UI components - Update to work with AI Persons

### Phase 2: Migration Script Details

**Step 1: Scan Existing State**
```typescript
- Query all LLM objects (via reverse map 'LLM' → 'owner')
- Identify LLM objects with personId (these need migration)
- Count existing Person/Profile/Someone objects that look like AI contacts
- Report: "Found X LLM objects, Y have personId, Z existing Persons"
```

**Step 2: Create LLM Persons**
```typescript
for each LLM object:
  - Extract: modelId, name, provider, server
  - Call: AIManager.createLLM(modelId, name, provider, llmConfigId)
  - Result: LLM Person with Profile.llmConfigId pointing to LLM object
  - Cache: modelId → llmPersonId
```

**Step 3: Create AI Persons**
```typescript
for each LLM object:
  - Get llmPersonId from Step 2
  - Generate aiId: "ai-${modelId}" or reuse old personId pattern
  - Call: AIManager.createAI(aiId, name, llmPersonId)
  - Result: AI Person with Profile.delegatesTo = llmPersonId
  - Cache: modelId → aiPersonId (for topic migration)
```

**Step 4: Update Topic Registrations**
```typescript
- AITopicManager state is in-memory only (not persisted)
- No direct migration needed - will rebuild on next scanExistingConversations()
- But: Must ensure group members are updated so scan finds correct AI Person
```

**Step 5: Update Group Memberships**
```typescript
- For each Topic object with group:
  - Get group members (HashGroup.person)
  - Find old AI Person (created by AIContactManager)
  - Replace with new AI Person (from Step 3)
  - Store updated Group/HashGroup
```

**Step 6: Clean Up LLM Objects**
```typescript
for each LLM object:
  - Remove personId field
  - Store updated version
```

**Step 7: Verification**
```typescript
- For each modelId:
  - Verify LLM Person exists
  - Verify AI Person exists
  - Verify delegation: resolveLLMPerson(aiPersonId) == llmPersonId
  - Verify at least one topic uses the AI Person
```

### Phase 3: Code Updates

**Priority 1: Core Components**

1. **AITopicManager** (`AITopicManager.ts`):
   ```typescript
   // BEFORE:
   private _topicModelMap: Map<string, string>;  // topicId → modelId

   // AFTER:
   private _topicAIMap: Map<string, SHA256IdHash<Person>>;  // topicId → aiPersonId

   // Update methods:
   - registerAITopic(topicId, aiPersonId)  // was: modelId
   - getAIPersonForTopic(topicId)  // was: getModelIdForTopic
   - scanExistingConversations() - look for AI Person not modelId
   ```

2. **AIAssistantPlan** (`AIAssistantPlan.ts`):
   ```typescript
   // BEFORE:
   private contactManager: AIContactManager;

   // AFTER:
   private aiManager: AIManager;

   // Update constructor to inject AIManager instead of AIContactManager
   // Update all ensureAIContactForModel calls to use AIManager methods
   ```

3. **AIMessageProcessor** (`AIMessageProcessor.ts`):
   ```typescript
   // Add resolution method:
   async _resolveLLMForAI(aiPersonId: SHA256IdHash<Person>): Promise<{
     llmPersonId: SHA256IdHash<Person>,
     modelId: string,
     config: LLM
   }> {
     const llmPersonId = await this.aiManager.resolveLLMPerson(aiPersonId);
     // Get profile to find llmConfigId
     // Load LLM config object
     // Return complete info
   }

   // Update processMessage to resolve AI → LLM before calling chat()
   ```

**Priority 2: Type Definitions**

1. **@OneObjectInterfaces.d.ts**:
   ```typescript
   // Remove from LLM interface:
   - personId?: SHA256IdHash<Person>;
   - capabilities?: Array<'chat' | 'inference'>;

   // These belong to AI Person, not LLM config
   ```

2. **interfaces.ts**:
   ```typescript
   // Update IAIContactManager → IAIManager:
   interface IAIManager {
     createAI(aiId, name, delegatesTo): Promise<SHA256IdHash<Person>>;
     createLLM(modelId, name, provider): Promise<SHA256IdHash<Person>>;
     setAIDelegation(aiId, delegatesTo): Promise<void>;
     resolveLLMPerson(personId): Promise<SHA256IdHash<Person>>;
     // ... other methods
   }

   // Update IAITopicManager:
   - getAIPersonForTopic(topicId): SHA256IdHash<Person> | null;
   ```

**Priority 3: UI Components**

1. **LLMSettings.tsx** (`browser-ui/src/components/Settings/LLMSettings.tsx`):
   ```typescript
   // Update startChatWithModel:
   - Instead of finding AI contact by modelId
   - Create AI Person on-the-fly or select existing
   - Set delegation to selected LLM Person
   - Create conversation with AI Person
   ```

2. **ChatView/ChatLayout**:
   - Participants are already Person IDs
   - Should work without changes (just use AI Person instead of LLM-based Person)
   - May need updates to display which LLM the AI is using

### Phase 4: Testing Strategy

**Unit Tests**:
- AIManager: createAI, createLLM, delegation, resolution
- AITopicManager: registration with AI personId
- Migration script: all steps in isolation

**Integration Tests**:
1. Create AI Person → Create LLM Person → Link via delegation
2. Register topic with AI Person
3. Send message → Resolve AI → LLM → Get response
4. Switch AI delegation → Verify new LLM used
5. AI → AI → LLM chain resolution

**Manual Testing**:
1. Run migration on dev instance with existing data
2. Verify all existing topics still work
3. Create new AI assistant
4. Switch model for existing AI
5. Test AI chaining (create AI that delegates to another AI)

---

## Risk Assessment

### High Risk

1. **Data Loss**:
   - **Risk**: Migration fails, existing AI contacts lost
   - **Mitigation**: Backup ONE.core storage before migration
   - **Rollback**: Restore from backup

2. **Broken Conversations**:
   - **Risk**: Topic registrations lost, messages not processed
   - **Mitigation**: `scanExistingConversations()` rebuilds registry
   - **Rollback**: Migration script re-creates old structure

### Medium Risk

1. **Group Membership Issues**:
   - **Risk**: Updating group members could break access control
   - **Mitigation**: Test thoroughly, verify access after migration
   - **Rollback**: Re-create groups with old members

2. **UI Confusion**:
   - **Risk**: Users see both AI Person and LLM Person in contacts
   - **Mitigation**: Update UI to hide LLM Persons, show only AI Persons
   - **Rollback**: N/A (UI only)

### Low Risk

1. **Performance**:
   - **Risk**: Delegation resolution adds latency
   - **Mitigation**: Cache delegation results in AIManager
   - **Rollback**: N/A

---

## Implementation Checklist

### Before Starting
- [ ] Review this plan with team
- [ ] Backup production data (ONE.core storage)
- [ ] Create feature branch: `feature/ai-llm-separation`

### Phase 1: Foundation (Week 1)
- [x] Create AIManager.ts
- [x] Create architecture docs
- [ ] Write comprehensive tests for AIManager
- [ ] Review AIManager with team

### Phase 2: Migration Script (Week 1-2)
- [ ] Implement migration script
- [ ] Add rollback capability
- [ ] Test migration on synthetic data
- [ ] Test migration on real dev data
- [ ] Document migration procedure

### Phase 3: Core Updates (Week 2)
- [ ] Update AITopicManager
- [ ] Update AIAssistantPlan
- [ ] Update AIMessageProcessor
- [ ] Update type definitions
- [ ] Run existing tests, fix breakages

### Phase 4: UI Updates (Week 3)
- [ ] Update LLMSettings component
- [ ] Update ChatView/ChatLayout
- [ ] Add UI for switching AI delegation
- [ ] Add UI for creating custom AI assistants
- [ ] Test UI flows end-to-end

### Phase 5: Testing & Validation (Week 3-4)
- [ ] Run full test suite
- [ ] Manual testing checklist
- [ ] Performance testing
- [ ] Migration dry-run on staging
- [ ] Fix any issues found

### Phase 6: Deployment (Week 4)
- [ ] Run migration on staging
- [ ] Verify staging works
- [ ] Run migration on production
- [ ] Monitor for issues
- [ ] Document rollback procedure if needed

---

## Open Questions

1. **Default AI Names**: When migrating, what should we name the AI Persons?
   - Option A: Use model name (e.g., "claude-sonnet-4-5")
   - Option B: Use generic name (e.g., "Claude")
   - Option C: Let user rename after migration
   - **Decision needed**: ?

2. **Private Variants**: Currently there's a `-private` suffix pattern. How to handle?
   - Option A: Create separate AI Person for private variant
   - Option B: Use same AI Person, just different topic settings
   - **Decision needed**: ?

3. **UI for AI Management**: Where should users manage AI assistants?
   - Option A: New "AI Assistants" section in Settings
   - Option B: Integrate into existing LLM Settings
   - Option C: Contacts-style interface for managing AIs
   - **Decision needed**: ?

4. **Backwards Compatibility**: Should we support old API for a transition period?
   - Option A: No - clean break
   - Option B: Yes - support both APIs for 1-2 releases
   - **Decision needed**: Clean break (already decided Option B migration)

---

## Success Criteria

1. ✅ All existing AI contacts migrated to AI/LLM Person structure
2. ✅ All existing conversations continue to work
3. ✅ Users can switch which LLM their AI uses
4. ✅ New AI assistants can be created with custom names
5. ✅ AI → AI delegation works (tested)
6. ✅ No LLM.personId field remains in codebase
7. ✅ All tests passing
8. ✅ Documentation updated

---

## Timeline Estimate

- **Week 1**: Foundation + Migration Script (8-10 hours)
- **Week 2**: Core Component Updates (10-12 hours)
- **Week 3**: UI Updates + Testing (10-12 hours)
- **Week 4**: Deployment + Monitoring (4-6 hours)

**Total**: ~32-40 hours of development work

---

## Next Steps

1. **Review this plan** - Get feedback on approach
2. **Address open questions** - Make decisions on unknowns
3. **Start implementation** - Begin with Phase 1 checklist
4. **Iterate** - Adjust plan based on findings during implementation
