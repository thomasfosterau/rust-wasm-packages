/**
 * The `workerd` npm package ships no type declarations. This is the part of
 * its `lib/main.js` the tests use.
 */
declare module "workerd" {
  /** Absolute path of the `workerd` binary for this platform. */
  const binaryPath: string;
  export default binaryPath;
}
