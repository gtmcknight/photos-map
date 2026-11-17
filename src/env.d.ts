/** True in `npm run dev` builds. Strips the reload hook from release builds. */
declare const __DEV__: boolean;

/** CSS imported as text (esbuild text loader). */
declare module '*.css' {
  const text: string;
  export default text;
}
