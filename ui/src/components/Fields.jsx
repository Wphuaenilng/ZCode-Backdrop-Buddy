import { useEffect, useState } from 'react';
import { HEX } from '../data/params.js';

export function RangeField({ id, label, value, min = 0, max = 100, onChange, testId }) {
  const fill = (((value - min) / (max - min)) * 100).toFixed(1);

  return (
    <div className="field">
      <label htmlFor={id}>{label} <output>{value}%</output></label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        style={{ '--fill': `${fill}%` }}
        onChange={(event) => onChange(+event.target.value)}
        data-testid={testId || id}
      />
    </div>
  );
}

export function SelectField({ id, label, value, options, onChange, testId, disabled = false }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="select2"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId || id}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

export function ColorField({ id = 'accent', value, onChange }) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <div className="field">
      <label htmlFor={`${id}-text`}>主题强调色</label>
      <div className="color-row">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="选择强调色"
        />
        <input
          id={`${id}-text`}
          className="input"
          value={text}
          maxLength={7}
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (HEX.test(next)) onChange(next);
          }}
          onBlur={() => setText(value)}
          data-testid={`${id}-text`}
        />
      </div>
    </div>
  );
}
