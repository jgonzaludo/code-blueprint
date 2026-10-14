// the plugin carries its own copy of the skill (a plugin can't reach outside its folder).
// skill/claude-code/SKILL.md is the source of truth, this keeps the copy identical.
import fs from 'node:fs';

fs.copyFileSync('skill/claude-code/SKILL.md', 'plugin/skills/blueprint/SKILL.md');
console.log('plugin skill synced');
