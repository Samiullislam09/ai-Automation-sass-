// GENERATED — do not edit. Source: packages/agent-contract/src/manifest.ts
// Edit the package, then run: node scripts/sync-contract.mjs
/**
 * Manifest types + validator (MASTER_PLAN §6.2).
 *
 * The manifest is what an agent returns from GET /manifest. The brain reads it
 * to build the intent prompt (phrases), the planner graph (needs/provides),
 * the countdown (estimated_seconds) and the office/workspace UI (office).
 */

/** Type strings allowed in `input` / `output` schemas: "string", "string[]", "number?", "object" ... */
export type FieldType =
  | "string"
  | "string[]"
  | "number"
  | "number[]"
  | "boolean"
  | "boolean[]"
  | "object"
  | "object[]"
  | "string?"
  | "string[]?"
  | "number?"
  | "number[]?"
  | "boolean?"
  | "boolean[]?"
  | "object?"
  | "object[]?";

export type FieldSchema = Record<string, FieldType>;

/** Template strings the brain renders for the user; the agent never writes user copy itself. */
export interface UserMessages {
  started?: string;
  progress?: string;
  done?: string;
  failed?: string;
}

export interface ActionSpec {
  /** Stable action id, e.g. "write_article". */
  id: string;
  /** Natural-language triggers fed to the intent engine. */
  phrases: string[];
  input: FieldSchema;
  output: FieldSchema;
  /** true → the brain echoes before running (principle 2). */
  irreversible: boolean;
  /** Used for countdowns and the watchdog (2× = timeout). Positive integer. */
  estimated_seconds: number;
  /** Non-negative integer, brain's cost accounting. */
  cost_units: number;
  /** Names of outputs (from other actions' `provides`) this action needs. */
  needs: string[];
  /** Name of what this action provides to the planner graph. Defaults to `id`. */
  provides: string;
  /** Optional step in a plan: the planner may skip it. */
  optional?: boolean;
  user_messages?: UserMessages;
}

export interface OfficeSpec {
  room: string;
  ico: string;
  color: string;
}

export interface Manifest {
  id: string;
  name: string;
  /** semver "MAJOR.MINOR.PATCH" (optional prerelease/build). */
  version: string;
  description: string;
  actions: ActionSpec[];
  office: OfficeSpec;
}

/**
 * Loose input form: `provides` may be omitted (defaults to action id).
 * This is what agent authors write; `validateManifest` normalises it.
 */
export type ManifestInput = Omit<Manifest, "actions"> & {
  actions: Array<Omit<ActionSpec, "provides"> & { provides?: string }>;
};

export type ValidateResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; errors: string[] };

const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  "string", "string[]", "number", "number[]", "boolean", "boolean[]", "object", "object[]",
  "string?", "string[]?", "number?", "number[]?", "boolean?", "boolean[]?", "object?", "object[]?",
]);

const ID_RE = /^[a-z][a-z0-9_]*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/**
 * Validate an unknown value as a Manifest. Hand-written checks, no dependencies.
 * Every error names the exact path and the rule that failed.
 */
export function validateManifest(x: unknown): ValidateResult {
  const errors: string[] = [];

  if (!isRecord(x)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  // ---- top level -----------------------------------------------------------
  if (!isNonEmptyString(x.id)) errors.push("id must be a non-empty string");
  else if (!ID_RE.test(x.id)) errors.push(`id "${x.id}" must match ${ID_RE} (lowercase, digits, underscore)`);

  if (!isNonEmptyString(x.name)) errors.push("name must be a non-empty string");

  if (!isNonEmptyString(x.version)) errors.push("version must be a non-empty string");
  else if (!SEMVER_RE.test(x.version)) errors.push(`version "${x.version}" must be semver (e.g. 1.2.0)`);

  if (!isNonEmptyString(x.description)) errors.push("description must be a non-empty string");

  // ---- office ---------------------------------------------------------------
  if (!isRecord(x.office)) {
    errors.push("office must be an object {room, ico, color}");
  } else {
    if (!isNonEmptyString(x.office.room)) errors.push("office.room must be a non-empty string");
    if (!isNonEmptyString(x.office.ico)) errors.push("office.ico must be a non-empty string");
    if (!isNonEmptyString(x.office.color)) errors.push("office.color must be a non-empty string");
    else if (!HEX_COLOR_RE.test(x.office.color)) errors.push(`office.color "${x.office.color}" must be a hex colour like #b48bff`);
  }

  // ---- actions --------------------------------------------------------------
  const actions: ActionSpec[] = [];
  if (!Array.isArray(x.actions)) {
    errors.push("actions must be an array");
  } else if (x.actions.length === 0) {
    errors.push("actions must contain at least one action");
  } else {
    const seenIds = new Set<string>();
    x.actions.forEach((raw, i) => {
      const p = `actions[${i}]`;
      if (!isRecord(raw)) {
        errors.push(`${p} must be an object`);
        return;
      }
      const a = raw;

      let id = "";
      if (!isNonEmptyString(a.id)) errors.push(`${p}.id must be a non-empty string`);
      else if (!ID_RE.test(a.id)) errors.push(`${p}.id "${a.id}" must match ${ID_RE}`);
      else if (seenIds.has(a.id)) errors.push(`${p}.id "${a.id}" is duplicated`);
      else { seenIds.add(a.id); id = a.id; }

      if (!Array.isArray(a.phrases)) errors.push(`${p}.phrases must be an array of strings`);
      else if (a.phrases.length === 0) errors.push(`${p}.phrases must contain at least one phrase`);
      else a.phrases.forEach((ph, j) => { if (!isNonEmptyString(ph)) errors.push(`${p}.phrases[${j}] must be a non-empty string`); });

      for (const key of ["input", "output"] as const) {
        const schema = a[key];
        if (!isRecord(schema)) {
          errors.push(`${p}.${key} must be an object of field → type string`);
          continue;
        }
        for (const [field, type] of Object.entries(schema)) {
          if (typeof type !== "string" || !FIELD_TYPES.has(type)) {
            errors.push(`${p}.${key}.${field} has unknown type ${JSON.stringify(type)}; allowed: ${[...FIELD_TYPES].join(", ")}`);
          }
        }
      }

      if (typeof a.irreversible !== "boolean") errors.push(`${p}.irreversible must be a boolean`);

      if (!Number.isInteger(a.estimated_seconds) || (a.estimated_seconds as number) <= 0) {
        errors.push(`${p}.estimated_seconds must be a positive integer`);
      }
      if (!Number.isInteger(a.cost_units) || (a.cost_units as number) < 0) {
        errors.push(`${p}.cost_units must be a non-negative integer`);
      }

      if (!Array.isArray(a.needs)) errors.push(`${p}.needs must be an array of strings (may be empty)`);
      else a.needs.forEach((n, j) => { if (!isNonEmptyString(n)) errors.push(`${p}.needs[${j}] must be a non-empty string`); });

      let provides = id;
      if (a.provides !== undefined) {
        if (!isNonEmptyString(a.provides)) errors.push(`${p}.provides must be a non-empty string when present`);
        else provides = a.provides;
      }

      if (a.optional !== undefined && typeof a.optional !== "boolean") errors.push(`${p}.optional must be a boolean when present`);

      let user_messages: UserMessages | undefined;
      if (a.user_messages !== undefined) {
        if (!isRecord(a.user_messages)) {
          errors.push(`${p}.user_messages must be an object {started?, progress?, done?, failed?}`);
        } else {
          user_messages = {};
          for (const [k, v] of Object.entries(a.user_messages)) {
            if (!["started", "progress", "done", "failed"].includes(k)) errors.push(`${p}.user_messages.${k} is not a known key`);
            else if (typeof v !== "string") errors.push(`${p}.user_messages.${k} must be a string`);
            else (user_messages as Record<string, string>)[k] = v;
          }
        }
      }

      if (id && Array.isArray(a.needs) && a.needs.includes(provides)) {
        errors.push(`${p}.needs must not include its own provides ("${provides}")`);
      }

      actions.push({
        id,
        phrases: Array.isArray(a.phrases) ? (a.phrases as string[]) : [],
        input: (a.input as FieldSchema) ?? {},
        output: (a.output as FieldSchema) ?? {},
        irreversible: a.irreversible === true,
        estimated_seconds: a.estimated_seconds as number,
        cost_units: a.cost_units as number,
        needs: Array.isArray(a.needs) ? (a.needs as string[]) : [],
        provides,
        ...(a.optional !== undefined ? { optional: a.optional as boolean } : {}),
        ...(user_messages ? { user_messages } : {}),
      });
    });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      id: x.id as string,
      name: x.name as string,
      version: x.version as string,
      description: x.description as string,
      actions,
      office: {
        room: (x.office as OfficeSpec).room,
        ico: (x.office as OfficeSpec).ico,
        color: (x.office as OfficeSpec).color,
      },
    },
  };
}

/**
 * Check a runtime value against a FieldSchema. Returns error strings (empty = ok).
 * Used by runAction for input (→ non-retryable error) and output (→ failed run).
 */
export function validateAgainstSchema(schema: FieldSchema, value: unknown, path = "input"): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  for (const [field, type] of Object.entries(schema)) {
    const optional = type.endsWith("?");
    const base = optional ? type.slice(0, -1) : type;
    const isArray = base.endsWith("[]");
    const scalar = isArray ? base.slice(0, -2) : base;
    const v = value[field];
    if (v === undefined || v === null) {
      if (!optional) errors.push(`${path}.${field} is required (${type})`);
      continue;
    }
    const checkScalar = (s: unknown): boolean =>
      scalar === "object" ? isRecord(s) : typeof s === scalar;
    if (isArray) {
      if (!Array.isArray(v)) errors.push(`${path}.${field} must be ${type}`);
      else if (!v.every(checkScalar)) errors.push(`${path}.${field} must contain only ${scalar}`);
    } else if (!checkScalar(v)) {
      errors.push(`${path}.${field} must be ${type}`);
    }
  }
  return errors;
}
