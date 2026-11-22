"use client";
import { Children, Fragment, isValidElement, useId } from "react";
import type { ReactNode } from "react";
import { usePixelSelect } from "@/hooks/usePixelSelect";
import type { SelectOption } from "@/hooks/usePixelSelect";
import { PixelIcon } from "@/components/ui/PixelIcon";

type OptionNode = {
  value?: string | number;
  label?: string;
  disabled?: boolean;
  children?: ReactNode;
};
function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<OptionNode>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join("");
}
function collectOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionNode>(child)) return [];
    if (child.type === Fragment) return collectOptions(child.props.children);
    if (child.type !== "option") return [];
    const label = child.props.label ?? textContent(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: child.props.disabled,
      },
    ];
  });
}
export type SelectProps = {
  label: string;
  children: ReactNode;
  id?: string;
  name?: string;
  form?: string;
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  hint?: string;
  error?: string;
};
export function Select({
  label,
  children,
  id,
  name,
  form,
  value,
  defaultValue,
  onValueChange,
  disabled,
  autoFocus,
  hint,
  error,
}: SelectProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const listId = `${fieldId}-list`;
  const options = collectOptions(children);
  const {
    root: rootRef,
    trigger: triggerRef,
    menu: menuRef,
    selected: selectedValue,
    open,
    active,
    unavailable,
    close,
    toggle,
    keyDown,
    setActive,
    choose,
  } = usePixelSelect({
    options,
    value,
    defaultValue,
    onValueChange,
    disabled,
  });
  const selected = options.find((option) => option.value === selectedValue);
  return (
    <div
      className="pixel-field pixel-select"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <label id={`${fieldId}-label`} htmlFor={fieldId}>
        {label}
      </label>
      {name && (
        <input
          type="hidden"
          name={name}
          form={form}
          value={selectedValue}
          disabled={disabled}
        />
      )}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        form={form}
        className="pixel-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${fieldId}-label`}
        aria-activedescendant={
          open && active >= 0 ? `${listId}-${active}` : undefined
        }
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${fieldId}-message` : undefined}
        disabled={unavailable}
        autoFocus={autoFocus}
        onClick={toggle}
        onKeyDown={keyDown}
      >
        <span className="pixel-select-value">
          {selected?.label ??
            (options.length ? "선택하세요" : "선택 가능한 항목이 없어요")}
        </span>
        <svg
          className="pixel-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2 5h3v2h2v2h2V7h2V5h3v3h-2v2h-2v2H6v-2H4V8H2z" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          popover="manual"
          className="pixel-select-menu"
          aria-labelledby={`${fieldId}-label`}
        >
          {options.map((option, index) => (
            <div
              id={`${listId}-${index}`}
              key={`${option.value}:${index}`}
              role="option"
              aria-selected={option.value === selectedValue}
              aria-disabled={option.disabled || undefined}
              data-option-index={index}
              data-active={index === active}
              className="pixel-select-option"
              onPointerMove={(event) => {
                if (event.pointerType === "mouse" && !option.disabled)
                  setActive(index);
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              <span className="pixel-select-check">
                {option.value === selectedValue && (
                  <PixelIcon name="check" width="18" height="18" />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {(hint || error) && (
        <p
          id={`${fieldId}-message`}
          className={error ? "pixel-error-text" : "pixel-muted"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
