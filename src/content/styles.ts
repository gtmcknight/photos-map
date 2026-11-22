// Values measured from photos.google.com (Nov 2026) in both of its themes, so the
// view reads as Google's own: Google Sans 22/28 page title, Google Sans Text
// 14/20 labels, 4px grid gaps, 16px card radius.
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.view {
  --surface: #ffffff;
  --text: #1f1f1f;
  --muted: #444746;
  --line: #c4c7c5;
  --blue: #0b57d0;
  --track: #d3e3fd;
  --tint: #f0f4f9;
  --outline: #747775;
  --hover: rgba(11, 87, 208, 0.06);
  --control: #ffffff;
  --control-icon: #666666;
  --control-line: #e6e6e6;
  --control-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  --credit: rgba(255, 255, 255, 0.75);
  --land: #f5f5f5;
  --bar-on: 0.5;
  --bar-off: 0.14;
  --sans: "Google Sans Text", "Google Sans", Roboto, Arial, sans-serif;
  --display: "Google Sans", Roboto, Arial, sans-serif;
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--text);
  font: 400 14px/20px var(--sans);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  container-type: inline-size;
}
.view[data-theme="dark"] {
  --surface: #131314;
  --text: #e3e3e3;
  --muted: #c4c7c5;
  --line: #444746;
  --blue: #a8c7fa;
  --track: #004a77;
  --tint: #1e1f20;
  --outline: #8e918f;
  --hover: rgba(168, 199, 250, 0.08);
  --control: #282a2c;
  --control-icon: #c4c7c5;
  --control-line: #3c3e40;
  --control-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  --credit: rgba(19, 19, 20, 0.75);
  --land: #25272b;
  --bar-on: 0.8;
  --bar-off: 0.22;
}

.bar {
  flex: none;
  margin-top: 12px;
  height: 57px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--line);
}
h1 { margin: 0; font: 400 22px/28px var(--display); color: var(--text); }
.status { margin-left: auto; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

button { font: 500 14px/20px var(--sans); cursor: pointer; }
.text-button {
  height: 40px;
  padding: 0 24px;
  border: 1px solid var(--outline);
  border-radius: 20px;
  background: transparent;
  color: var(--blue);
}
.text-button:hover { background: var(--hover); }
.text-button:active { transform: scale(0.97); }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

.body { position: relative; flex: 1; min-height: 0; display: flex; }

.progress { position: absolute; z-index: 2; left: 0; right: 0; top: 0; height: 4px; overflow: hidden; background: var(--track); }
.progress::before {
  content: "";
  position: absolute;
  inset: 0;
  width: 40%;
  background: var(--blue);
  animation: travel 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
@keyframes travel { from { transform: translateX(-100%); } to { transform: translateX(250%); } }

.stage { position: relative; flex: 1; min-width: 0; background: var(--land); overflow: hidden; }
/* Its own layer, so bubbles and pins stay under the zoom buttons and the years. */
.map { position: absolute; inset: 0; z-index: 0; }
.map .maplibregl-canvas:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.map-note { position: absolute; inset: 0; margin: 0; display: grid; place-content: center; padding: 24px; text-align: center; color: var(--muted); }

.zoom {
  position: absolute;
  right: 16px;
  bottom: 40px;
  display: flex;
  flex-direction: column;
  background: var(--control);
  border-radius: 8px;
  box-shadow: var(--control-shadow);
  overflow: hidden;
}
.zoom button { width: 40px; height: 40px; border: 0; padding: 0; background: var(--control); color: var(--control-icon); display: grid; place-items: center; }
.zoom button:hover { color: var(--text); }
.zoom button:active svg { transform: scale(0.9); }
.zoom button:focus-visible { outline-offset: -2px; }
.zoom hr { height: 1px; width: 24px; margin: 0 auto; border: 0; background: var(--control-line); }
.zoom svg { width: 24px; height: 24px; fill: currentColor; }

.credit {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 0 6px;
  font: 400 12px/18px var(--sans);
  color: var(--muted);
  background: var(--credit);
  border-top-left-radius: 4px;
}
.credit a { color: inherit; text-decoration: none; }
.credit a:hover { text-decoration: underline; }

/* A group of photos: MapLibre positions .bubble, so only the face animates. */
.bubble { cursor: pointer; outline: none; }
.bubble-face {
  position: relative;
  border-radius: 50%;
  border: 2px solid #fff;
  background: var(--tint);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  animation: bubble-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: box-shadow 150ms ease-out;
}
.bubble:hover .bubble-face { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55); }
.bubble:active .bubble-face { transform: scale(0.97); }
.bubble:focus-visible .bubble-face { outline: 2px solid var(--blue); outline-offset: 2px; }
.bubble-face img { display: block; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.bubble-count {
  position: absolute;
  top: -6px;
  left: calc(100% - 14px);
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #fff;
  color: #1f1f1f;
  font: 500 12px/20px var(--sans);
  text-align: center;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
@keyframes bubble-in { from { opacity: 0; transform: scale(0.8); } }

/* The years: a bar per year for the photos in view, on a rail with two handles. */
.years {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  width: min(440px, calc(100% - 160px));
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--control);
  border-radius: 8px;
  box-shadow: var(--control-shadow);
  user-select: none;
  -webkit-user-select: none;
}
.years-label { margin-top: 26px; font: 500 14px/20px var(--sans); font-variant-numeric: tabular-nums; color: var(--text); }
.years-track { position: relative; flex: 1; height: 100%; cursor: pointer; touch-action: none; }
.years-bars { position: absolute; left: 0; right: 0; top: 14px; height: 20px; display: flex; align-items: flex-end; gap: 2px; pointer-events: none; }
.years-bars i {
  flex: 1;
  height: 100%;
  background: var(--blue);
  opacity: var(--bar-off);
  transform: scaleY(0);
  transform-origin: 50% 100%;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease-out;
}
.years-bars i.on { opacity: var(--bar-on); }
.years-rail { position: absolute; left: 0; right: 0; top: 34px; height: 4px; border-radius: 2px; background: var(--track); pointer-events: none; }
.years-fill { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: var(--blue); }
.years-thumb {
  position: absolute;
  top: 36px;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: var(--blue);
  box-shadow: 0 0 0 2px var(--control);
  cursor: grab;
}
.years.dragging .years-track, .years.dragging .years-thumb { cursor: grabbing; }
.years.by-pointer .years-thumb:focus-visible { outline: none; }

/* The photo bubble MapLibre pins to a spot; its tail tip is the spot. */
.pin { width: 72px; height: 84px; pointer-events: none; z-index: 1000; }
.pin-photo {
  position: absolute;
  left: 0;
  top: 0;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 3px solid #fff;
  background: var(--tint);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  transform-origin: 50% 100%;
}
.pin.on .pin-photo { animation: pop 160ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.92); } }
.pin-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pin-tail {
  position: absolute;
  left: 29px;
  top: 70px;
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 10px solid #fff;
}

.panel { flex: none; width: clamp(320px, 34%, 460px); display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); position: relative; }
.head { flex: none; height: 72px; padding: 0 16px; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.head-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.title { font: 500 16px/24px var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { color: var(--muted); white-space: nowrap; }
.dates { margin: 0; min-height: 20px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scroller { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; color-scheme: light; }
.view[data-theme="dark"] .scroller { color-scheme: dark; }
.sizer { position: relative; }

.day { position: absolute; left: 16px; right: 16px; top: 0; padding-top: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.date { font-weight: 500; }
.place { color: var(--muted); margin-left: 6px; }
.row { position: absolute; left: 16px; right: 16px; top: 0; display: grid; gap: 4px; }
.tile { position: relative; display: block; aspect-ratio: 1; background: var(--tint); overflow: hidden; }
.tile:focus-visible { outline-offset: -2px; }
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.duration {
  position: absolute;
  top: 6px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  color: #fff;
  font: 500 12px/16px var(--sans);
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
}
.duration::after {
  content: "";
  width: 16px;
  height: 16px;
  background: #fff;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 14.5v-9l6 4.5-6 4.5z'/%3E%3C/svg%3E") center / contain no-repeat;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
}

.empty { position: absolute; inset: 72px 0 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center; color: var(--muted); }
.empty p { margin: 0; font: 400 16px/24px var(--sans); text-wrap: balance; }

/* A search with nothing on the map has no years to choose between. */
.view.no-results .years { display: none; }

/*
 * A narrow window: the photos go under the map. Beside it, the map would be
 * too narrow for the years and the credit line.
 */
@container (max-width: 700px) {
  .body { flex-direction: column; }
  .stage { flex: 3 1 0; min-height: 0; }
  .panel { flex: 2 1 0; width: auto; border-left: 0; border-top: 1px solid var(--line); }
}

@media (prefers-reduced-motion: reduce) {
  .progress::before { animation-duration: 3s; }
  .pin.on .pin-photo, .bubble-face { animation: none; }
  .years-bars i { transition: opacity 150ms ease-out; }
}
`;
