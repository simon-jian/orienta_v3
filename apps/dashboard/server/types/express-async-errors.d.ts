/**
 * express-async-errors ships no type declarations. It is a side-effect-only
 * import that patches express.Router methods to forward rejected promises
 * from async handlers to the Express error middleware; there is no runtime
 * API to type beyond "importing this module has an effect".
 */
declare module "express-async-errors";
