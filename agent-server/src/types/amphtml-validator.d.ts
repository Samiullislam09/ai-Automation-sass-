/** `amphtml-validator` ships no types and has no @types package. Only the two members
 *  lib/media/story.ts actually calls are declared, deliberately: a fuller guess at the
 *  package's shape would be a fiction the compiler then enforces. */
declare module "amphtml-validator" {
  export type ValidationError = {
    severity: "ERROR" | "WARNING";
    line: number;
    col: number;
    message: string;
    code?: string;
    specUrl?: string | null;
  };
  export type ValidationResult = { status: "PASS" | "FAIL" | "UNKNOWN"; errors: ValidationError[] };
  export type Validator = { validateString(html: string, format?: string): ValidationResult };
  /** Downloads the ruleset from cdn.ampproject.org on first call — which is why story.ts puts
   *  a timeout around it and has its own structural checks for when it cannot be reached. */
  export function getInstance(url?: string): Promise<Validator>;
}
