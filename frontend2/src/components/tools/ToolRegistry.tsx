import { ToolDefinition, ToolPermission } from "@/types/agent";
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Wrench } from "lucide-react";

interface ToolRegistryProps {
  tools: ToolDefinition[];
  onPermissionChange: (toolId: string, permission: ToolPermission) => void;
}

const permissionConfig: Record<ToolPermission, { icon: typeof ShieldCheck; label: string; className: string }> = {
  allow: { icon: ShieldCheck, label: "Allow", className: "text-success bg-success/10" },
  ask: { icon: ShieldAlert, label: "Ask", className: "text-warning bg-warning/10" },
  forbid: { icon: ShieldOff, label: "Forbid", className: "text-destructive bg-destructive/10" },
};

const permissionCycle: ToolPermission[] = ["allow", "ask", "forbid"];

export function ToolRegistry({ tools, onPermissionChange }: ToolRegistryProps) {
  const categories = [...new Set(tools.map((t) => t.category))];

  const cyclePermission = (tool: ToolDefinition) => {
    const idx = permissionCycle.indexOf(tool.permission);
    const next = permissionCycle[(idx + 1) % permissionCycle.length];
    onPermissionChange(tool.id, next);
  };

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Shield className="w-4 h-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tool Permissions</h3>
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground px-1 mb-1.5">{cat}</h4>
          <div className="space-y-0.5">
            {tools
              .filter((t) => t.category === cat)
              .map((tool) => {
                const perm = permissionConfig[tool.permission];
                const PermIcon = perm.icon;
                return (
                  <div
                    key={tool.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 transition-colors group"
                  >
                    <Wrench className="w-3 h-3 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono font-medium text-foreground">{tool.name}</span>
                    </div>
                    <button
                      onClick={() => cyclePermission(tool)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${perm.className}`}
                      title={`Click to change (${tool.description})`}
                    >
                      <PermIcon className="w-3 h-3" />
                      {perm.label}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
