import vm from "node:vm";

export class ParseError extends Error {}

const KIT_START_ANCHOR = "kit.start(app, element, ";

function findMatchingBraceEnd(source, openIndex) {
  let depth = 0;
  let quote = null; // one of ' " ` while inside a string literal

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\") {
        i++; // skip escaped character
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractKitStartObjectSource(html) {
  const anchorIndex = html.indexOf(KIT_START_ANCHOR);
  if (anchorIndex === -1) {
    throw new ParseError("Could not find kit.start(app, element, ...) anchor in event page HTML");
  }

  const openBraceIndex = html.indexOf("{", anchorIndex + KIT_START_ANCHOR.length);
  if (openBraceIndex === -1) {
    throw new ParseError("Found kit.start anchor but no opening brace followed it");
  }

  const closeBraceIndex = findMatchingBraceEnd(html, openBraceIndex);
  if (closeBraceIndex === -1) {
    throw new ParseError("Unbalanced braces while extracting kit.start payload");
  }

  return html.slice(openBraceIndex, closeBraceIndex + 1);
}

function evaluateObjectLiteral(source) {
  const context = vm.createContext({ Date });
  let result;
  try {
    result = vm.runInContext(`(${source})`, context, { timeout: 2000 });
  } catch (err) {
    throw new ParseError(`Failed to evaluate kit.start payload as JS: ${err.message}`);
  }

  // Object/array literals evaluated in the vm context belong to a different
  // realm (different Object.prototype), which breaks strict deep-equality
  // checks downstream. Clone into the current realm so callers get plain,
  // same-realm objects/arrays/Dates.
  try {
    return structuredClone(result);
  } catch (err) {
    throw new ParseError(`kit.start payload could not be cloned out of the vm sandbox: ${err.message}`);
  }
}

function extractInnerData(kitStartPayload) {
  const dataArr = kitStartPayload?.data;
  if (!Array.isArray(dataArr) || dataArr.length < 3) {
    throw new ParseError("kit.start payload is missing the expected data[] array");
  }

  const inner = dataArr[2]?.data;
  if (!inner || typeof inner !== "object") {
    throw new ParseError("kit.start payload's data[2].data is missing");
  }

  return inner;
}

function validateShape(inner) {
  const { event, map } = inner;

  if (!event || typeof event.id !== "string" || typeof event.name !== "string") {
    throw new ParseError("Parsed payload is missing event.id/event.name");
  }
  if (!(event.start instanceof Date) || !(event.stop instanceof Date)) {
    throw new ParseError("Parsed payload's event.start/event.stop are not Date instances");
  }
  if (!map || !map.status || typeof map.status.usages !== "object") {
    throw new ParseError("Parsed payload is missing map.status.usages");
  }
  if (typeof map.status.capacities !== "object") {
    throw new ParseError("Parsed payload is missing map.status.capacities");
  }
  if (!Array.isArray(map.disabled)) {
    throw new ParseError("Parsed payload is missing map.disabled array");
  }
  if (typeof map.url !== "string") {
    throw new ParseError("Parsed payload is missing map.url");
  }
  if (!map.prices || typeof map.prices !== "object") {
    throw new ParseError("Parsed payload is missing map.prices");
  }
}

export function parseEventPage(html) {
  const objectSource = extractKitStartObjectSource(html);
  const kitStartPayload = evaluateObjectLiteral(objectSource);
  const inner = extractInnerData(kitStartPayload);
  validateShape(inner);

  return { event: inner.event, map: inner.map };
}
