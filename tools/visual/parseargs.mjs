/**
 * parseArgs, lifted from thrixel/build-world's tools/lib/harness.mjs.
 *
 * The original lives in a module that imports playwright at the top level, so
 * importing it would drag a browser driver into a script that only reads PNGs.
 * Eight lines, copied rather than depended on. Apache-2.0, see LICENSE in this
 * directory.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    })
  );
}
