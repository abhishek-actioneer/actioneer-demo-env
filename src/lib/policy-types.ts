export interface TableAccessRule {
  tableName: string;
  allowSelectStar: boolean;
  allowAllColumns: boolean;
  allowedColumns: string[];
  rowFilter: string | null;
  rowFilterDescription: string | null;
}

export interface DataPolicy {
  id: string;
  name: string;
  description: string;
  datasetId: string;
  tableAccess: TableAccessRule[];
  createdAt: string;
  createdBy: string;
}

export type WorkspaceRole = "super-admin" | "admin" | "member";

export const WORKSPACE_ROLES: { id: WorkspaceRole; label: string }[] = [
  { id: "super-admin", label: "Super Admin" },
  { id: "admin", label: "Admin" },
  { id: "member", label: "Member" },
];

export interface MockUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  lastActive: string;
  role: WorkspaceRole;
}
