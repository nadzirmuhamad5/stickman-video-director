// Wrapper: render a canvas project via the installed stickman skill renderer.
// Usage: node scripts/render-autopilot.mjs <project.json>
// Emits per-shot progress JSON lines (from the renderer) and a final
// REPORT_JSON:{...} line that the web app parses.
import { loadProject } from '../skills/directing-stickman-videos/scripts/autopilot-core.mjs';
import { render } from '../skills/directing-stickman-videos/scripts/autopilot-render.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/render-autopilot.mjs <project.json>');
  process.exit(1);
}

const p = loadProject(file);
const report = await render(p, { full: true, replace: true });
console.log(
  'REPORT_JSON:' +
    JSON.stringify({
      output: report.output,
      duration: report.duration,
      frames: report.frames,
      caption_count: report.caption_count,
      shot_count: report.shot_count,
    })
);
