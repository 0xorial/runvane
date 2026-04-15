import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

type ResizableSidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: ReactNode;
  children: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  sideClassName?: string;
  mainClassName?: string;
};

export function ResizableSidePanel({
  open,
  onOpenChange,
  side,
  children,
  defaultSize = 20,
  minSize = 14,
  maxSize,
  sideClassName,
  mainClassName,
}: ResizableSidePanelProps) {
  const sidePanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    const panel = sidePanelRef.current;
    if (!panel) return;
    if (open && panel.isCollapsed()) {
      panel.expand();
      return;
    }
    if (!open && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [open]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 w-full">
      <ResizablePanel
        ref={sidePanelRef}
        defaultSize={defaultSize}
        minSize={minSize}
        {...(typeof maxSize === "number" ? { maxSize } : {})}
        collapsible
        collapsedSize={0}
        onExpand={() => onOpenChange(true)}
        onCollapse={() => onOpenChange(false)}
        className={cn("h-full min-h-0 min-w-0 overflow-hidden", sideClassName)}
      >
        {side}
      </ResizablePanel>

      <ResizableHandle
        withHandle={open}
        className={cn("transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />

      <ResizablePanel
        minSize={typeof maxSize === "number" ? Math.max(0, 100 - maxSize) : 0}
        className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", mainClassName)}
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
