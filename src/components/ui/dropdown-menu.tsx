import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";
import { Check, ChevronRight } from "@/components/icons";

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[180px] origin-(--radix-dropdown-menu-content-transform-origin) animate-pop-in overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg shadow-(color:--shadow-color)",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "flex select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-body text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2.5 py-1.5 text-small font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The row classes every item shares, so a checkbox, a choice and a
 * submenu sit on the same grid as a plain item. */
const ROW =
  "flex select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-body text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** On or off, with the tick at the end of the row where the eye lands
 * after reading the label. */
function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={cn(ROW, className)} {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <DropdownMenuPrimitive.ItemIndicator className="flex shrink-0 items-center">
        {/* inline, because the row greys every icon in it and a tick is
            the one mark that should not be grey */}
        <Check style={{ color: "var(--brand-ink)" }} />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

/** One of a few, ticked the way a checkbox item is. */
function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={cn(ROW, className)} {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <DropdownMenuPrimitive.ItemIndicator className="flex shrink-0 items-center">
        {/* inline, because the row greys every icon in it and a tick is
            the one mark that should not be grey */}
        <Check style={{ color: "var(--brand-ink)" }} />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

/** A row that opens a further menu, saying what is chosen in it now. */
function DropdownMenuSubTrigger({
  className,
  children,
  value,
  icon,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { value?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(ROW, "data-[state=open]:bg-accent", className)}
      {...props}
    >
      {/* before the label, on the grid a plain item's icon sits on */}
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value !== undefined && <span className="shrink-0 text-small text-muted-foreground">{value}</span>}
      <ChevronRight />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[160px] origin-(--radix-dropdown-menu-content-transform-origin) animate-pop-in overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg shadow-(color:--shadow-color)",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
