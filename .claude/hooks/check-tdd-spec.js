// PostToolUse hook (Write|Edit): warns if a .ts file written under any
// services/ or utils/ folder under src/app/ (e.g. src/app/core/services/,
// src/app/features/<name>/utils/) has no sibling .spec.ts file.
// See .claude/skills/tdd-workflow/SKILL.md.
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path || data?.tool_response?.filePath;
    if (!filePath) return;

    const normalized = filePath.replace(/\\/g, '/');
    const isTarget = /\/src\/app\/.*\/(services|utils)\/.*\.ts$/.test(normalized);
    const isSpec = normalized.endsWith('.spec.ts');
    if (!isTarget || isSpec) return;

    const specPath = filePath.replace(/\.ts$/, '.spec.ts');
    if (!fs.existsSync(specPath)) {
      const name = path.basename(filePath);
      console.log(JSON.stringify({
        systemMessage: `TDD reminder: ${name} has no sibling spec file. See .claude/skills/tdd-workflow/SKILL.md`,
      }));
    }
  } catch {
    // Never block on a parsing error — this hook is advisory only.
  }
});
