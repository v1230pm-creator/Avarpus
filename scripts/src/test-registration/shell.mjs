/**
 * Splits a POSIX shell command line into simple commands.
 *
 * Validation step commands and package.json scripts are short `a && b`
 * chains with quoted arguments, `VAR=value` prefixes and the odd
 * redirection. This tokenizer understands exactly that: quotes, backslash
 * escapes, the `&&` / `||` / `;` / `|` / newline separators, and
 * redirections (which it drops). Variable references stay literal — nothing
 * that decides which tests run lives behind a variable here.
 */

const SEPARATORS = ["&&", "||", ";;", ";", "|", "&", "\n"];

/**
 * @param {string} command
 * @returns {string[][]} one argv per simple command, in execution order
 */
export function splitCommands(command) {
  const commands = [];
  let argv = [];
  let word = "";
  let hasWord = false;
  let i = 0;

  const endWord = () => {
    if (hasWord) argv.push(word);
    word = "";
    hasWord = false;
  };
  const endCommand = () => {
    endWord();
    if (argv.length > 0) commands.push(stripRedirections(argv));
    argv = [];
  };

  while (i < command.length) {
    const c = command[i];
    const separator = SEPARATORS.find((s) => command.startsWith(s, i));
    if (separator) {
      endCommand();
      i += separator.length;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "(" || c === ")") {
      endWord();
      i++;
      continue;
    }
    hasWord = true;
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) {
          word += command[i + 1];
          i += 2;
        } else {
          word += command[i];
          i++;
        }
      }
      i++;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      if (command[i + 1] !== "\n") word += command[i + 1];
      i += 2;
      continue;
    }
    word += c;
    i++;
  }
  endCommand();
  return commands;
}

/** Removes `>file`, `2>&1`, `< file` and friends from an argv. */
function stripRedirections(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Bare operator (`>`, `2>`, `2>&1`): a plain one also owns the next word.
    if (/^\d*(>>?|<)(&\d+|&-)?$/.test(arg)) {
      if (!arg.includes("&")) i++;
      continue;
    }
    // Operator glued to its target (`>/dev/null`, `2>/dev/null`).
    if (/^\d*(>>?|<)\S+$/.test(arg)) continue;
    out.push(arg);
  }
  return out;
}

/** `VAR=value` prefixes that the shell would apply to the command. */
export function isEnvAssignment(arg) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg);
}
