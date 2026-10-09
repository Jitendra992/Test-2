import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Plus, ShieldCheck, Users } from "lucide-react";
import type { AuthRole, AuthUser, Employee } from "@shared/api";
import { AUTH_ROLES, createUser, listUsers, updateUser } from "@/lib/auth-api";
import { PageHeading } from "@/components/page-heading";

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  employeeId: string;
  active: boolean;
};

const employeeRoles: AuthRole[] = ["MD", "COO", "President", "Employee"];
const isEmployeeRole = (role: AuthRole) => employeeRoles.includes(role);
const emptyForm = (): UserForm => ({
  name: "",
  email: "",
  password: "",
  role: "Receptionist",
  employeeId: "",
  active: true,
});

export function AdminUsersPage({
  currentUser,
  employees,
  onCurrentUserUpdated,
}: {
  currentUser: AuthUser;
  employees: Employee[];
  onCurrentUserUpdated: (user: AuthUser) => void;
}) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setUsers(await listUsers());
      setError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load authorized accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const beginCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
  };

  const beginEdit = (user: AuthUser) => {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      employeeId: user.employeeId || "",
      active: user.active,
    });
    setError("");
  };

  const changeRole = (role: AuthRole) => {
    setForm((current) => ({
      ...current,
      role,
      employeeId: isEmployeeRole(role)
        ? current.employeeId || employees.find((employee) => employee.active)?.id || ""
        : "",
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const linkedEmployeeId = isEmployeeRole(form.role) ? form.employeeId || null : null;
      let saved: AuthUser;
      if (editing) {
        saved = await updateUser(editing.id, {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          employeeId: linkedEmployeeId,
          active: form.active,
          ...(form.password ? { password: form.password } : {}),
        });
        setUsers((current) => current.map((item) => item.id === saved.id ? saved : item));
      } else {
        saved = await createUser({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          employeeId: linkedEmployeeId,
          active: form.active,
        });
        setUsers((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (saved.id === currentUser.id) onCurrentUserUpdated(saved);
      setEditing(null);
      setForm(emptyForm());
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save this account.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: AuthUser) => {
    setError("");
    try {
      const updated = await updateUser(user.id, { active: !user.active });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (updated.id === currentUser.id) onCurrentUserUpdated(updated);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not update account access.");
    }
  };

  const activeEmployees = employees.filter((employee) => employee.active);

  return <>
    <PageHeading
      eyebrow="Admin Panel · access"
      title="Account management"
      description="Create named accounts, assign roles, and disable access when someone no longer needs it."
      action={!editing && <button className="button" onClick={beginCreate} data-testid="button-add-account"><Plus size={14}/>Add account</button>}
    />
    {error && <div className="queue-error form-error" role="alert" data-testid="text-account-error">{error}</div>}
    {editing !== null && <form className="panel account-form" onSubmit={submit} data-testid="form-account">
      <div className="panel-header"><div><h2 className="panel-title">{editing ? "Edit authorized account" : "Create authorized account"}</h2><p className="panel-subtitle">Employee registration is closed; only Admins can create accounts.</p></div></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="account-name">Name <span>*</span></label><input id="account-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} maxLength={120} required data-testid="input-account-name"/></div>
        <div className="field"><label htmlFor="account-email">Email <span>*</span></label><input id="account-email" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} autoComplete="off" required data-testid="input-account-email"/></div>
        <div className="field"><label htmlFor="account-role">Role <span>*</span></label><select id="account-role" value={form.role} onChange={event => changeRole(event.target.value as AuthRole)} data-testid="select-account-role">{AUTH_ROLES.map(role => <option key={role} value={role}>{role === "Employee" ? "Senior / Employee" : role}</option>)}</select></div>
        {isEmployeeRole(form.role) && <div className="field"><label htmlFor="account-employee">Linked employee <span>*</span></label><select id="account-employee" value={form.employeeId} onChange={event => setForm(current => ({ ...current, employeeId: event.target.value }))} required data-testid="select-account-employee"><option value="">Choose an active employee</option>{activeEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.designation || employee.department || "Employee"}</option>)}</select>{activeEmployees.length === 0 && <small className="field-help">Add an active employee in Employee management first.</small>}</div>}
        <div className="field"><label htmlFor="account-password">{editing ? "New password" : "Password"} {!editing && <span>*</span>}</label><input id="account-password" type="password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} minLength={12} required={!editing} autoComplete="new-password" placeholder={editing ? "Leave blank to keep the current password" : "At least 12 characters"} data-testid="input-account-password"/>{!editing && <small className="field-help">Passwords are stored as salted hashes and are never displayed.</small>}</div>
        <label className="permission-option account-active-option"><input type="checkbox" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))} data-testid="checkbox-account-active"/><span><strong>Account is active</strong><small>Inactive accounts cannot sign in.</small></span></label>
      </div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => { setEditing(null); setError(""); }} data-testid="button-cancel-account">Cancel</button><button type="submit" className="button" disabled={saving || (isEmployeeRole(form.role) && activeEmployees.length === 0)} data-testid="button-save-account">{saving ? "Saving…" : editing ? "Save changes" : "Create account"}</button></div>
    </form>}
    <section className="panel account-list-panel">
      <div className="panel-header"><div><h2 className="panel-title">Authorized accounts</h2><p className="panel-subtitle">Roles determine which panels and API actions are available.</p></div><span className="status accepted">{users.filter(user => user.active).length} active</span></div>
      {loading ? <div className="empty-state compact-empty">Loading accounts…</div> : users.length ? <div className="table-wrap"><table className="account-table"><thead><tr><th>Account</th><th>Role</th><th>Linked employee</th><th>Access</th><th>Manage</th></tr></thead><tbody>{users.map(user => {
        const linked = employees.find(employee => employee.id === user.employeeId);
        return <tr key={user.id} data-testid={`row-account-${user.id}`}><td><span className="person-name">{user.name}</span><span className="person-sub">{user.email}</span></td><td>{user.role === "Employee" ? "Senior / Employee" : user.role}</td><td>{linked?.name || (user.employeeId ? "Employee record unavailable" : "—")}</td><td><span className={`status ${user.active ? "accepted" : "declined"}`}>{user.active ? "Active" : "Inactive"}</span></td><td><div className="row-actions"><button className="button small secondary" onClick={() => beginEdit(user)} data-testid={`button-edit-account-${user.id}`}>Edit</button><button className={`button small ${user.active ? "danger" : ""}`} disabled={user.id === currentUser.id} onClick={() => void toggleActive(user)} data-testid={`button-toggle-account-${user.id}`}>{user.active ? "Deactivate" : "Activate"}</button></div></td></tr>;
      })}</tbody></table></div> : <div className="empty-state compact-empty"><span className="empty-art"><Users size={25}/></span><strong>No authorized accounts yet</strong><p>Create accounts here. There is no public registration form.</p><button className="button secondary" onClick={beginCreate}><Plus size={14}/>Add the first account</button></div>}
    </section>
    <div className="privacy-note admin-privacy"><KeyRound size={17}/><span><strong>Private sign-in</strong>Passwords are hashed on the API server. Use Account management to assign or revoke panel access.</span></div>
    <div className="admin-privacy"><span className="person-sub">For a Senior / Employee account, link an active employee record with the matching transfer permissions.</span></div>
    <span className="sr-only"><ShieldCheck size={1}/></span>
  </>;
}