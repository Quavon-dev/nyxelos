// tests/skill_registry.test.ts
import { SkillRegistry } from '../server/src/skills-registry';

describe('Skill Registry Merging', () => {
  it('should merge dynamic skills into the hardcoded registry correctly', () => {
    // Setup: Initialize with base registry (skills-registry.ts)
    const registry = new SkillRegistry(); 

    // Inject a dynamic skill from the database migration '0008'
    const dynamicSkill = { kind: 'file_read', config: {}, sensitive: false };
    registry.addDynamicSkill(dynamicSkill);

    // Assert that both the hardcoded and dynamic skills are available for tool building.
    expect(registry.isSkillAvailable('file_read')).toBe(true);
  });

  it('should prioritize permissions/sensitivity flags from the dynamic configuration', () => {
    // Test scenario where a dynamically added skill might override or be constrained by existing flags.
  });
});