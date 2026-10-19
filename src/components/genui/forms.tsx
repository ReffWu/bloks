// Forms an agent puts to the person: fields, checked as they are filled,
// whose answers go back as the person's next message.
//
// Native controls wherever the platform already has one (a select, a
// radio, a checkbox, a date), because they bring the keyboard, the screen
// reader and the dark mode with them; the app's own field, textarea and
// slider where it has those. Nothing here sends anything: the form's
// button does, through the same action path as every other click
// (src/lib/genui/actions.ts), which is also what writes the answers out.
import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import {
  FormNameContext,
  FormValidationContext,
  parseStructuredRules,
  useCreateFormValidation,
  useFormName,
  useFormValidation,
  useIsStreaming,
  useSetDefaultValue,
  useSetFieldValue,
  useStateField,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Input as UiInput } from "@/components/ui/input";
import { Slider as UiSlider, type SliderStop } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { useLabels } from "./host";
import { elements, figure, isElement, list, num, text } from "./read";

type Part = ComponentRenderer<Record<string, unknown>>;

/** Whether this form's answers have gone. A sent form keeps what was
 * entered, so the transcript still shows what was asked and answered,
 * but it cannot be sent twice. */
export const FormSent = createContext<{ sent: boolean; markSent: () => void }>({ sent: false, markSent: () => {} });

/** The id a FormControl's label points at, handed to its field. */
const FieldId = createContext<string | undefined>(undefined);

export const Form: Part = ({ props, renderNode }) => {
  const validation = useCreateFormValidation();
  const [sent, setSent] = useState(false);
  const name = text(props.name) || "form";
  const done = useMemo(() => ({ sent, markSent: () => setSent(true) }), [sent]);
  return (
    <FormValidationContext.Provider value={validation}>
      <FormNameContext.Provider value={name}>
        <FormSent.Provider value={done}>
          <div role="form" aria-label={name} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            {list(props.fields).length > 0 && <div className="flex flex-col gap-3.5">{renderNode(props.fields)}</div>}
            <div className="flex flex-wrap items-center gap-3">
              {renderNode(props.buttons)}
              {sent && (
                <span role="status" className="flex animate-fade-in items-center gap-1 text-small text-muted-foreground">
                  <Check size={12} strokeWidth={2.4} aria-hidden className="text-success" />
                  Sent
                </span>
              )}
            </div>
          </div>
        </FormSent.Provider>
      </FormNameContext.Provider>
    </FormValidationContext.Provider>
  );
};

export const FormControl: Part = ({ props, renderNode }) => {
  const id = useId();
  const labels = useLabels();
  const validation = useFormValidation();
  const input = isElement(props.input) ? props.input : null;
  const name = text(input?.props.name);
  const label = text(props.label);
  // said as the form draws, so the answers read in the order they were asked
  if (name && label) labels?.setField(name, label);
  const error = name ? validation?.errors[name] : undefined;
  const hint = text(props.hint);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-body font-medium text-foreground">
          {label}
        </label>
      )}
      <FieldId.Provider value={id}>{renderNode(input)}</FieldId.Provider>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-small text-muted-foreground">{hint}</p>
      )}
    </div>
  );
};

/**
 * One field's state, rules and lock, the same for every kind.
 *
 * A field bound to a `$variable` keeps its value there, where the rest of
 * the answer can read it, and is copied into its form too: the form's
 * answers are what is sent, and a bound field would otherwise go missing
 * from them.
 */
function useField(props: Record<string, unknown>, componentType: string) {
  const streaming = useIsStreaming();
  const { sent } = useContext(FormSent);
  const formName = useFormName();
  const setFieldValue = useSetFieldValue();
  const validation = useFormValidation();
  const name = text(props.name) || componentType.toLowerCase();
  const field = useStateField<unknown>(name, props.value);
  const ruleKey = JSON.stringify(props.rules ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => parseStructuredRules(props.rules), [ruleKey]);
  const value = field.value;
  useEffect(() => {
    if (streaming || !rules.length || !validation) return;
    validation.registerField(name, rules, () => value);
    return () => validation.unregisterField(name);
  }, [name, value, validation, rules, streaming]);
  const set = (next: unknown, check = false) => {
    field.setValue(next);
    if (field.isReactive && formName) setFieldValue(formName, componentType, name, next);
    if (rules.length && validation) {
      if (check) validation.validateField(name, next, rules);
      else validation.clearFieldError(name);
    }
  };
  return {
    name,
    value,
    set,
    formName,
    disabled: streaming || sent,
    invalid: Boolean(validation?.errors[name]),
    check: (next: unknown) => rules.length && validation?.validateField(name, next, rules),
  };
}

export const Input: Part = ({ props }) => {
  const id = useContext(FieldId);
  const field = useField(props, "Input");
  const type = ["email", "number", "url"].includes(text(props.type)) ? text(props.type) : "text";
  return (
    <UiInput
      id={id}
      name={field.name}
      type={type}
      placeholder={text(props.placeholder)}
      value={text(field.value)}
      disabled={field.disabled}
      aria-invalid={field.invalid || undefined}
      onChange={(e) => field.set(e.target.value)}
      onBlur={(e) => field.check(e.target.value)}
      className="aria-invalid:border-destructive/60"
    />
  );
};

export const TextArea: Part = ({ props }) => {
  const id = useContext(FieldId);
  const field = useField(props, "TextArea");
  const rows = Math.min(12, Math.max(2, num(props.rows) ?? 3));
  return (
    <Textarea
      id={id}
      name={field.name}
      rows={rows}
      placeholder={text(props.placeholder)}
      value={text(field.value)}
      disabled={field.disabled}
      aria-invalid={field.invalid || undefined}
      onChange={(e) => field.set(e.target.value)}
      onBlur={(e) => field.check(e.target.value)}
      className="resize-y aria-invalid:border-destructive/60"
    />
  );
};

export const Select: Part = ({ props }) => {
  const id = useContext(FieldId);
  const labels = useLabels();
  const field = useField(props, "Select");
  const items = elements(props.items, "SelectItem").map((item) => ({ value: text(item.props.value), label: text(item.props.label) }));
  for (const item of items) if (item.value && item.label) labels?.setOption(field.name, item.value, item.label);
  const placeholder = text(props.placeholder);
  return (
    <div className="relative">
      <select
        id={id}
        name={field.name}
        value={text(field.value)}
        disabled={field.disabled}
        aria-invalid={field.invalid || undefined}
        onChange={(e) => field.set(e.target.value, true)}
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent pr-8 pl-3 text-ui text-foreground outline-none transition-[border-color] duration-150 focus-visible:border-ring/60 disabled:opacity-50 aria-invalid:border-destructive/60",
          !text(field.value) && "text-muted-foreground",
        )}
      >
        <option value="" disabled>
          {placeholder || "Choose…"}
        </option>
        {items.map((item, i) => (
          <option key={i} value={item.value} className="text-foreground">
            {item.label || item.value}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
};

// The box itself takes the app's focus ring, the same one everything
// else wears: a native radio or checkbox inside is a field, and fields
// never wear it (styles.css).
const CHOICE =
  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-[border-color,background-color] duration-150 hover:bg-accent/40 has-[:checked]:border-brand-ink/50 has-[:checked]:bg-brand-soft/40 has-[:disabled]:cursor-default has-[:disabled]:opacity-70 has-[:focus-visible]:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]";

export const RadioGroup: Part = ({ props }) => {
  const id = useContext(FieldId);
  const group = useId();
  const labels = useLabels();
  const field = useField(props, "RadioGroup");
  useSetDefaultValue({
    formName: field.formName,
    componentType: "RadioGroup",
    name: field.name,
    existingValue: field.value,
    defaultValue: text(props.defaultValue) || undefined,
  });
  const items = elements(props.items, "RadioItem");
  return (
    <div id={id} role="radiogroup" className="flex flex-col gap-1.5">
      {items.map((item, i) => {
        const value = text(item.props.value);
        const label = text(item.props.label);
        if (value && label) labels?.setOption(field.name, value, label);
        const description = text(item.props.description);
        return (
          <label key={i} className={CHOICE}>
            <input
              type="radio"
              name={group}
              value={value}
              checked={text(field.value) === value}
              disabled={field.disabled}
              onChange={() => field.set(value, true)}
              className="mt-[3px] size-3.5 shrink-0 accent-(--brand-ink) outline-none"
            />
            <span className="min-w-0">
              <span className="block text-body text-foreground">{label || value}</span>
              {description && <span className="block text-small text-muted-foreground">{description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
};

export const CheckBoxGroup: Part = ({ props }) => {
  const id = useContext(FieldId);
  const labels = useLabels();
  const field = useField(props, "CheckBoxGroup");
  const items = elements(props.items, "CheckBoxItem");
  const ticked = (field.value && typeof field.value === "object" ? field.value : {}) as Record<string, boolean>;
  const defaults = Object.fromEntries(items.filter((item) => item.props.defaultChecked === true).map((item) => [text(item.props.name), true]));
  useSetDefaultValue({
    formName: field.formName,
    componentType: "CheckBoxGroup",
    name: field.name,
    existingValue: field.value,
    defaultValue: Object.keys(defaults).length ? defaults : undefined,
  });
  return (
    <div id={id} role="group" className="flex flex-col gap-1.5">
      {items.map((item, i) => {
        const key = text(item.props.name) || String(i);
        const label = text(item.props.label);
        if (label) labels?.setOption(field.name, key, label);
        const description = text(item.props.description);
        return (
          <label key={i} className={CHOICE}>
            <input
              type="checkbox"
              checked={ticked[key] === true}
              disabled={field.disabled}
              onChange={(e) => field.set({ ...ticked, [key]: e.target.checked }, true)}
              className="mt-[3px] size-3.5 shrink-0 accent-(--brand-ink) outline-none"
            />
            <span className="min-w-0">
              <span className="block text-body text-foreground">{label || key}</span>
              {description && <span className="block text-small text-muted-foreground">{description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
};

/** Most stops a slider is cut into. Past it, the step is widened. */
const MAX_STOPS = 1_001;

export const Slider: Part = ({ props }) => {
  const field = useField(props, "Slider");
  const min = num(props.min) ?? 0;
  const max = Math.max(min, num(props.max) ?? 100);
  const span = max - min;
  const asked = num(props.step) ?? (text(props.variant) === "continuous" ? span / 100 : 1);
  const step = Math.max(asked > 0 ? asked : 1, span / (MAX_STOPS - 1)) || 1;
  const stops = useMemo<SliderStop<number>[]>(() => {
    const out: SliderStop<number>[] = [];
    for (let i = 0; min + i * step <= max + 1e-9 && out.length < MAX_STOPS; i++) {
      const v = Number((min + i * step).toFixed(6));
      out.push({ value: v, label: figure(v) });
    }
    return out;
  }, [min, max, step]);
  const start = num(list(props.defaultValue)[0]);
  useSetDefaultValue({
    formName: field.formName,
    componentType: "Slider",
    name: field.name,
    existingValue: field.value,
    defaultValue: start === null ? undefined : [start],
  });
  if (!stops.length) return null;
  const current = num(list(field.value)[0]) ?? start ?? min;
  // the nearest stop, so a value between stops still shows where it is
  const at = stops.reduce((best, s) => (Math.abs(s.value - current) < Math.abs(best.value - current) ? s : best), stops[0]);
  return (
    <UiSlider
      stops={stops}
      value={at.value}
      disabled={field.disabled}
      onCommit={(v) => field.set([v])}
      aria-label={text(props.label) || field.name}
    />
  );
};

export const DatePicker: Part = ({ props }) => {
  const id = useContext(FieldId);
  const field = useField(props, "DatePicker");
  const look = "w-auto min-w-[10.5rem] [color-scheme:inherit] aria-invalid:border-destructive/60";
  if (text(props.mode) === "range") {
    const [from, to] = [text(list(field.value)[0]), text(list(field.value)[1])];
    return (
      <div className="flex flex-wrap items-center gap-2">
        <UiInput id={id} type="date" aria-label="From" value={from} disabled={field.disabled} onChange={(e) => field.set([e.target.value, to], true)} className={look} />
        <span className="text-small text-muted-foreground">to</span>
        <UiInput type="date" aria-label="To" value={to} min={from || undefined} disabled={field.disabled} onChange={(e) => field.set([from, e.target.value], true)} className={look} />
      </div>
    );
  }
  return (
    <UiInput
      id={id}
      type="date"
      value={text(field.value)}
      disabled={field.disabled}
      aria-invalid={field.invalid || undefined}
      onChange={(e) => field.set(e.target.value, true)}
      className={look}
    />
  );
};
