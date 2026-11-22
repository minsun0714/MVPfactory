"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
export type SelectOption = { value: string; label: string; disabled?: boolean };
export function usePixelSelect({
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
}: {
  options: SelectOption[];
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(
    String(defaultValue ?? options.find((o) => !o.disabled)?.value ?? ""),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", at: 0 });
  const selected = String(value ?? internal);
  const enabled = options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0);
  const unavailable = disabled || !enabled.length;
  const isDisabled = () =>
    unavailable || !!trigger.current?.matches(":disabled");
  function show(last = false) {
    if (isDisabled()) return;
    const current = options.findIndex(
      (o) => o.value === selected && !o.disabled,
    );
    setActive(
      current >= 0 ? current : last ? enabled[enabled.length - 1] : enabled[0],
    );
    typed.current = { text: "", at: 0 };
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || isDisabled()) return;
    if (value === undefined) setInternal(option.value);
    setOpen(false);
    trigger.current?.focus();
    if (option.value !== selected) onValueChange?.(option.value);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (isDisabled()) return;
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        show(event.key === "ArrowUp" || event.key === "End");
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        choose(active);
        return;
      }
      if (event.key === "Home") setActive(enabled[0]);
      else if (event.key === "End") setActive(enabled[enabled.length - 1]);
      else {
        const position = enabled.indexOf(active);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActive(
          enabled[(position + direction + enabled.length) % enabled.length],
        );
      }
      return;
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const text =
        (now - typed.current.at < 700 ? typed.current.text : "") +
        event.key.toLocaleLowerCase();
      typed.current = { text, at: now };
      const prefix = [...text].every((c) => c === text[0]) ? text[0] : text;
      const start = enabled.indexOf(active);
      const order = [
        ...enabled.slice(start + 1),
        ...enabled.slice(0, start + 1),
      ];
      const found = order.find((i) =>
        options[i].label.toLocaleLowerCase().startsWith(prefix),
      );
      if (!open) setOpen(true);
      if (found !== undefined) setActive(found);
      else if (!open) setActive(enabled[0]);
    }
  }
  useLayoutEffect(() => {
    const button = trigger.current,
      list = menu.current;
    if (!open || !button || !list) return;
    const position = () => {
      const bounds = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const below = viewportTop + height - bounds.bottom - 12;
      const above = bounds.top - viewportTop - 12;
      const upwards = below < 200 && above > below;
      list.style.width = `${Math.min(Math.max(bounds.width, 200), width - 24)}px`;
      list.style.maxHeight = `${Math.max(80, Math.min(320, upwards ? above : below))}px`;
      list.style.left = `${Math.max(viewportLeft + 12, Math.min(bounds.left, viewportLeft + width - list.getBoundingClientRect().width - 12))}px`;
      list.style.top = `${upwards ? bounds.top - list.getBoundingClientRect().height - 6 : bounds.bottom + 6}px`;
    };
    // The top layer escapes dialog overflow while preserving DOM ownership/focus trapping.
    list.showPopover?.();
    position();
    const scroll = (event: Event) => {
      if (!list.contains(event.target as Node)) position();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(button);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      observer.disconnect();
      if (list.hidePopover && list.matches(":popover-open")) list.hidePopover();
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    const fieldset = trigger.current?.closest("fieldset");
    const observer = new MutationObserver(() => {
      if (trigger.current?.matches(":disabled")) setOpen(false);
    });
    if (trigger.current)
      observer.observe(trigger.current, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    if (fieldset)
      observer.observe(fieldset, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      observer.disconnect();
    };
  }, [open]);
  useEffect(() => {
    const form = trigger.current?.form;
    const reset = () => {
      if (value === undefined)
        setInternal(
          String(defaultValue ?? options.find((o) => !o.disabled)?.value ?? ""),
        );
      setOpen(false);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, value, options]);
  return {
    root,
    trigger,
    menu,
    open: open && !unavailable,
    active,
    selected,
    unavailable,
    choose,
    keyDown,
    setActive,
    close: () => setOpen(false),
    toggle: () => (open ? setOpen(false) : show()),
  };
}
