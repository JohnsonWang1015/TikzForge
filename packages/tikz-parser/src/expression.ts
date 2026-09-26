/**
 * Evaluates the small arithmetic subset that shows up in coordinates after `\foreach`
 * substitution, e.g. `{2*3+1}` or `sqrt(2)`. Angles are degrees, as in PGF math. Anything else
 * returns undefined; nothing is ever executed.
 */
export function evaluateExpression(input: string): number | undefined {
  const text = input.trim().replace(/^\{([\s\S]*)\}$/u, '$1');
  let index = 0;

  const skip = (): void => {
    while (index < text.length && /\s/u.test(text[index] ?? '')) index += 1;
  };

  const functions: Record<string, (value: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: (value) => Math.sin((value * Math.PI) / 180),
    cos: (value) => Math.cos((value * Math.PI) / 180),
    tan: (value) => Math.tan((value * Math.PI) / 180),
  };

  function primary(): number | undefined {
    skip();
    const character = text[index];
    if (character === '(') {
      index += 1;
      const value = sum();
      skip();
      if (text[index] !== ')') return undefined;
      index += 1;
      return value;
    }
    if (character === '-' || character === '+') {
      index += 1;
      const value = power();
      return value === undefined ? undefined : character === '-' ? -value : value;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)/u.exec(text.slice(index))?.[0];
    if (number) {
      index += number.length;
      return Number.parseFloat(number);
    }
    const name = /^[a-z]+/u.exec(text.slice(index))?.[0];
    if (name === 'pi') {
      index += 2;
      return Math.PI;
    }
    const fn = name ? functions[name] : undefined;
    if (name && fn) {
      index += name.length;
      skip();
      if (text[index] !== '(') return undefined;
      const argument = primary();
      return argument === undefined ? undefined : fn(argument);
    }
    return undefined;
  }

  function power(): number | undefined {
    const base = primary();
    skip();
    if (base === undefined || text[index] !== '^') return base;
    index += 1;
    const exponent = power();
    return exponent === undefined ? undefined : base ** exponent;
  }

  function product(): number | undefined {
    let value = power();
    for (;;) {
      skip();
      const operator = text[index];
      if (value === undefined || (operator !== '*' && operator !== '/')) return value;
      index += 1;
      const right = power();
      if (right === undefined) return undefined;
      value = operator === '*' ? value * right : value / right;
    }
  }

  function sum(): number | undefined {
    let value = product();
    for (;;) {
      skip();
      const operator = text[index];
      if (value === undefined || (operator !== '+' && operator !== '-')) return value;
      index += 1;
      const right = product();
      if (right === undefined) return undefined;
      value = operator === '+' ? value + right : value - right;
    }
  }

  const result = sum();
  skip();
  return index === text.length && result !== undefined && Number.isFinite(result)
    ? result
    : undefined;
}
