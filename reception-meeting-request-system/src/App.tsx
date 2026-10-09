import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { AuthRole, AuthUser } from '@shared/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowRight, Check, ChevronRight, ClipboardList,
  DoorOpen, History, LayoutDashboard, LogOut, Menu, Plus, Search, ShieldCheck,
  UserRound, Users, X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  STATUSES,
  type Employee,
  type EmployeeAction,
  type MeetingRequest,
  type NewMeetingRequest,
  type Status,
} from '@/lib/reception-store';
import { ApiReceptionRepository } from '@/lib/reception-api';
import { homeForRole, roleCanOpenPath } from '@/lib/access-control';
import { getBootstrapStatus, getCurrentUser, signOut, type BootstrapStatus } from '@/lib/auth-api';
import { LoginPage, FirstAdminSetupPage } from '@/components/auth-pages';
import { PageHeading } from '@/components/page-heading';
import { AdminUsersPage } from '@/pages/admin-users';

const queryClient = new QueryClient();
const localDateKey = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const formatTime = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const requestedStates: Status[] = ['Requested', 'Waiting', 'Transferred'];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The change could not be saved.';

function StatusBadge({ status }: { status: Status }) {
  const cls = status.toLowerCase().replaceAll(' ', '-');
  return <span className={`status ${cls}`} data-testid={`status-${cls}`}>{status}</span>;
}
function Person({ name, sub }: { name: string; sub?: string }) {
  return <div className="person-cell"><span className="person-avatar" aria-hidden="true">{initials(name)}</span><span><span className="person-name">{name}</span>{sub && <span className="person-sub">{sub}</span>}</span></div>;
}
function AppShell({ children, user, onLogout, requests, employees }: { children: ReactNode; user: AuthUser; onLogout: () => void; requests: MeetingRequest[]; employees: Employee[] }) {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = user.role;
  const employeeRole = ['MD', 'COO', 'President', 'Employee'].includes(role);
  const links = role === 'Receptionist'
    ? [{ href: '/', label: 'Reception overview', icon: LayoutDashboard }, { href: '/requests/new', label: 'New meeting request', icon: Plus }, { href: '/requests', label: 'Live request queue', icon: ClipboardList, badge: requests.filter(r => !['Completed', 'Declined'].includes(r.status)).length || undefined }, { href: '/history', label: 'Visitor history', icon: History }]
    : employeeRole
      ? [{ href: '/employee', label: 'Employee panel', icon: LayoutDashboard }]
      : [{ href: '/admin', label: 'Admin overview', icon: LayoutDashboard }, { href: '/admin/team', label: 'Employee management', icon: Users }, { href: '/admin/users', label: 'Account management', icon: ShieldCheck }];
  const destinations: Record<AuthRole, string> = { Receptionist: '/', MD: '/employee', COO: '/employee', President: '/employee', Employee: '/employee', Admin: '/admin' };
  const roleLabel = employeeRole ? 'Senior / Employee' : role;
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href={destinations[role]} className="brand" data-testid="link-brand"><span className="brand-mark"><DoorOpen size={19}/></span><span><span className="brand-title">Reception</span><span className="brand-sub">Meeting Request System</span></span></Link>
      <div className="nav-label">{roleLabel} workspace</div>
      <nav id="main-navigation" aria-label={`${role} navigation`} className={menuOpen ? 'mobile-open' : ''}>{links.map(item => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={`nav-link ${path === item.href ? 'active' : ''}`} data-testid={`link-nav-${item.href.replaceAll('/', '-') || 'home'}`}><item.icon size={16}/><span>{item.label}</span>{item.badge && <span className="nav-count">{item.badge}</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><strong>Shared reception workspace</strong><span>Request updates are stored by the app API and shared with authorized accounts.</span></div><div className="profile"><span className="avatar"><ShieldCheck size={16}/></span><span className="profile-copy"><b>{user.name}</b><small>{roleLabel} · {user.email}</small></span><ChevronRight size={15}/></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb"><button type="button" className="mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(x => !x)} data-testid="button-mobile-navigation">{menuOpen ? <X size={17}/> : <Menu size={17}/>}</button><span className="crumb-brand">Reception</span><ChevronRight size={12} style={{ verticalAlign: 'middle', margin: '0 5px' }}/><span className="workspace-label">{roleLabel} Panel</span></div>
        <div className="top-actions"><span className="header-staff">{employees.length} staff</span><button type="button" className="button small secondary" onClick={() => void onLogout()} data-testid="button-logout"><LogOut size={14}/>Sign out</button></div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>;
}

function ReceptionHome({ requests, employees }: { requests: MeetingRequest[]; employees: Employee[] }) {
  const active = requests.filter(r => !['Completed', 'Declined'].includes(r.status));
  return <>
    <PageHeading eyebrow="Receptionist Panel" title="Front desk, in sync." description="Capture a visitor request, route it to the right person, and keep the lobby moving." action={<Link href="/requests/new" className="button" data-testid="button-new-meeting"><Plus size={15}/>New meeting request</Link>}/>
    <div className="overview-strip"><span className="overview-mark"><DoorOpen size={18}/></span><div><strong>A clear desk starts here.</strong><span>An Admin configures active employees before reception can route visitors.</span></div><span className="text-link">Admin managed</span></div>
    <div className="stats-grid"><div className="stat-card"><div className="stat-top">Open requests <span className="stat-icon"><ClipboardList size={15}/></span></div><div className="stat-value">{active.length}</div><div className="stat-note">Awaiting a next step</div></div><div className="stat-card"><div className="stat-top">Completed <span className="stat-icon"><Check size={15}/></span></div><div className="stat-value">{requests.filter(r => r.status === 'Completed').length}</div><div className="stat-note">Visitor records finished</div></div><div className="stat-card"><div className="stat-top">Active employees <span className="stat-icon"><Users size={15}/></span></div><div className="stat-value">{employees.filter(e => e.active).length}</div><div className="stat-note">Available to receive requests</div></div></div>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Live request queue</h2><p className="panel-subtitle">The latest visitor coordination activity</p></div><Link href="/requests" className="text-link" data-testid="link-home-queue">Open queue <ArrowRight size={14}/></Link></div>
      {requests.length ? <RequestList requests={requests.slice(0, 5)}/> : <div className="empty-state"><span className="empty-art"><ClipboardList size={25}/></span><strong>No meeting requests yet</strong><p>When reception creates a visitor request, it will appear here with its live status.</p><Link href="/requests/new" className="button secondary" data-testid="link-empty-create">Create the first request</Link></div>}
    </section>
  </>;
}
function RequestList({ requests, receptionActions }: { requests: MeetingRequest[]; receptionActions?: (request: MeetingRequest) => ReactNode }) {
  return <div className="table-wrap"><table><thead><tr><th>Visitor</th><th>Requested person</th><th>Purpose</th><th>Requested at / updated</th><th>Status</th>{receptionActions && <th>Reception action</th>}</tr></thead><tbody>{requests.map(r => <tr key={r.id} data-testid={`row-request-${r.id}`}><td><Person name={r.visitorName} sub={r.company || 'Company not provided'}/></td><td><span className="person-name">{r.requestedEmployeeName}</span><span className="person-sub">{['Completed', 'Declined'].includes(r.status) ? 'Last assigned to' : 'Currently with'} {r.assignedEmployeeName}</span></td><td>{r.purpose}</td><td><span className="person-name">{formatDate(r.requestedAt)} · {formatTime(r.requestedAt)}</span><span className="person-sub">Updated {formatDate(r.updatedAt)} · {formatTime(r.updatedAt)}</span></td><td><StatusBadge status={r.status}/></td>{receptionActions && <td><div className="row-actions">{receptionActions(r)}</div></td>}</tr>)}</tbody></table></div>;
}
function QueuePage({ requests, updateStatus }: { requests: MeetingRequest[]; updateStatus: (id: string, status: 'Called In' | 'Meeting' | 'Completed') => Promise<MeetingRequest> }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all');
  const [actionError, setActionError] = useState('');
  const filtered = useMemo(() => requests.filter(r => (status === 'all' || r.status === status) && (!query || `${r.visitorName} ${r.requestedEmployeeName} ${r.assignedEmployeeName} ${r.purpose} ${r.company}`.toLowerCase().includes(query.toLowerCase()))), [requests, query, status]);
  const [busyRequestId, setBusyRequestId] = useState('');
  const advance = async (id: string, next: 'Called In' | 'Meeting' | 'Completed') => {
    try { setBusyRequestId(id); await updateStatus(id, next); setActionError(''); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusyRequestId(''); }
  };
  const actions = (r: MeetingRequest) => r.status === 'Accepted' ? <button className="button small secondary" disabled={busyRequestId === r.id} onClick={() => void advance(r.id, 'Called In')} data-testid={`button-call-in-${r.id}`}>Mark called in</button> : r.status === 'Called In' ? <button className="button small secondary" disabled={busyRequestId === r.id} onClick={() => void advance(r.id, 'Meeting')} data-testid={`button-start-meeting-${r.id}`}>Start meeting</button> : r.status === 'Meeting' ? <button className="button small" disabled={busyRequestId === r.id} onClick={() => void advance(r.id, 'Completed')} data-testid={`button-complete-${r.id}`}>Complete</button> : <span className="person-sub">{['Completed', 'Declined'].includes(r.status) ? 'Closed' : 'With employee'}</span>;
  return <>
    <PageHeading eyebrow="Receptionist Panel · live" title="Request queue" description="Track incoming visitors and advance reception-side progress." action={<Link href="/requests/new" className="button" data-testid="button-queue-create"><Plus size={14}/>New request</Link>}/>
    <section className="panel">
      {actionError && <div className="queue-error form-error" role="alert">{actionError}</div>}
      <div className="toolbar"><div className="filters"><div className="search-box"><Search size={15}/><input aria-label="Search queue" placeholder="Search visitor, person or purpose" value={query} onChange={e => setQuery(e.target.value)} data-testid="input-queue-search"/></div><select className="filter-select" aria-label="Filter queue by status" value={status} onChange={e => setStatus(e.target.value)} data-testid="select-queue-status"><option value="all">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div><span className="toolbar-count">{filtered.length} {filtered.length === 1 ? 'request' : 'requests'}</span></div>
      {filtered.length ? <RequestList requests={filtered} receptionActions={actions}/> : <div className="empty-state"><ClipboardList size={26}/><strong>{requests.length ? 'No requests match those filters' : 'The queue is clear'}</strong><p>{requests.length ? 'Try a different search or status.' : 'New visitor requests will appear as soon as reception submits them.'}</p>{!requests.length && <Link href="/requests/new" className="button secondary">Create a request</Link>}</div>}
    </section>
  </>;
}
function NewRequest({ employees, onCreate }: { employees: Employee[]; onCreate: (values: NewMeetingRequest) => Promise<MeetingRequest> }) {
  const [, setPath] = useLocation();
  const recipients = employees.filter(e => e.active && e.canReceiveRequests);
  const needsRecipientSetup = recipients.length === 0;
  const [form, setForm] = useState({ visitorName: '', mobileNumber: '', company: '', purpose: '', requestedEmployeeId: '', visitorCount: '1', idVehicleNumber: '', remarks: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const employee = recipients.find(e => e.id === form.requestedEmployeeId);
    if (!employee) { setError('Choose an active employee who can receive requests.'); return; }
    if (!form.visitorName.trim() || !form.mobileNumber.trim() || !form.purpose.trim()) { setError('Visitor name, mobile number, and purpose are required.'); return; }
    const visitorCount = Number(form.visitorCount);
    if (!Number.isSafeInteger(visitorCount) || visitorCount < 1) { setError('Number of visitors must be a whole number greater than zero.'); return; }
    try {
      setSaving(true);
      await onCreate({
        visitorName: form.visitorName.trim(),
        mobileNumber: form.mobileNumber.trim(),
        company: form.company.trim(),
        purpose: form.purpose.trim(),
        requestedEmployeeId: employee.id,
        visitorCount,
        idVehicleNumber: form.idVehicleNumber.trim(),
        remarks: form.remarks.trim(),
      });
      setError('');
      setPath('/requests');
    } catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  };
  return <><PageHeading eyebrow="Receptionist Panel · intake" title="New meeting request" description="Record the visitor once and route the request to an active employee who can receive it."/>
    {needsRecipientSetup && <div className="overview-strip"><span className="overview-mark"><Users size={18}/></span><div><strong>No eligible employees have been added.</strong><span>Ask an Admin to add an active employee with request-receiving permission.</span></div><span className="text-link">Admin managed</span></div>}
    <div className="form-layout"><form className="panel form-card" onSubmit={submit} data-testid="form-new-request"><div className="form-intro"><span className="form-step">01</span><div><strong>Visitor details</strong><span>Required details are marked with an asterisk.</span></div></div><div className="form-grid">
      <div className="field"><label htmlFor="visitor-name">Visitor name <span>*</span></label><input id="visitor-name" value={form.visitorName} onChange={e => update('visitorName', e.target.value)} autoComplete="off" data-testid="input-visitor-name" required/></div>
      <div className="field"><label htmlFor="mobile-number">Mobile number <span>*</span></label><input id="mobile-number" type="tel" value={form.mobileNumber} onChange={e => update('mobileNumber', e.target.value)} autoComplete="off" data-testid="input-mobile-number" required/></div>
      <div className="field"><label htmlFor="visitor-company">Company / Organization</label><input id="visitor-company" value={form.company} onChange={e => update('company', e.target.value)} autoComplete="off" data-testid="input-visitor-company"/></div>
      <div className="field"><label htmlFor="visitor-purpose">Purpose of visit <span>*</span></label><input id="visitor-purpose" value={form.purpose} onChange={e => update('purpose', e.target.value)} data-testid="input-visitor-purpose" required/></div>
      <div className="field"><label htmlFor="requested-employee">Person to meet <span>*</span></label><select id="requested-employee" value={form.requestedEmployeeId} onChange={e => update('requestedEmployeeId', e.target.value)} data-testid="select-requested-employee" required disabled={needsRecipientSetup}><option value="">{needsRecipientSetup ? 'No eligible employees set up' : 'Select an employee'}</option>{recipients.map(e => <option key={e.id} value={e.id}>{e.name} · {e.designation || e.department || 'Employee'}</option>)}</select>{needsRecipientSetup && <small className="field-help">Employee setup is required before you can send this request.</small>}</div>
      <div className="field"><label htmlFor="visitor-count">Number of visitors</label><input id="visitor-count" type="number" min="1" value={form.visitorCount} onChange={e => update('visitorCount', e.target.value)} data-testid="input-visitor-count"/></div>
      <div className="field full"><label htmlFor="id-vehicle">Optional ID / Vehicle number</label><input id="id-vehicle" value={form.idVehicleNumber} onChange={e => update('idVehicleNumber', e.target.value)} data-testid="input-id-vehicle"/></div>
      <div className="field full"><label htmlFor="request-remarks">Remarks</label><textarea id="request-remarks" value={form.remarks} onChange={e => update('remarks', e.target.value)} data-testid="input-request-remarks"/></div>
      {error && <div className="field full form-error" role="alert" data-testid="text-form-error">{error}</div>}
    </div><div className="form-actions"><button type="submit" className="button" data-testid="button-submit-request" disabled={needsRecipientSetup || saving}>{saving ? 'Sending…' : 'Send meeting request'} <ArrowRight size={14}/></button></div></form>
    <aside><div className="side-note"><h3>What happens next?</h3><p>The selected employee receives this request in the Senior / Employee Panel. Updates are shared through the app API.</p></div><div className="privacy-note"><ShieldCheck size={17}/><span><strong>Authorized workspace</strong>Request records are visible according to the signed-in account’s role and assignment.</span></div></aside></div>
  </>;
}

function EmployeePanel({ employee, employees, requests, employeeAction, transferRequest }: { employee: Employee | undefined; employees: Employee[]; requests: MeetingRequest[]; employeeAction: (id: string, action: EmployeeAction) => Promise<MeetingRequest>; transferRequest: (id: string, targetEmployeeId: string) => Promise<MeetingRequest> }) {
  const [transferId, setTransferId] = useState('');
  const [transferTarget, setTransferTarget] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyRequestId, setBusyRequestId] = useState('');
  const incoming = employee ? requests.filter(r => r.assignedEmployeeId === employee.id) : [];
  const transferTargets = employee?.canTransferRequests ? employees.filter(e => e.active && e.canReceiveRequests && employee.transferTo.includes(e.id)) : [];
  const beginTransfer = (id: string) => { setTransferId(id); setTransferTarget(''); setActionError(''); };
  const runEmployeeAction = async (id: string, action: EmployeeAction) => {
    if (!employee) return;
    try { setBusyRequestId(id); await employeeAction(id, action); setActionError(''); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusyRequestId(''); }
  };
  const confirmTransfer = async () => {
    const target = transferTargets.find(e => e.id === transferTarget);
    if (!employee || !target) return;
    try {
      setBusyRequestId(transferId);
      await transferRequest(transferId, target.id);
      setTransferId('');
      setTransferTarget('');
      setActionError('');
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusyRequestId(''); }
  };
  return <>
    <PageHeading eyebrow="Senior / Employee Panel" title="Your visitor desk" description="Review reception requests, keep visitors informed, and route only within your approved transfer hierarchy."/>
    {actionError && <div className="queue-error form-error" role="alert">{actionError}</div>}
    {!employee ? <section className="empty-state panel setup-empty"><span className="empty-art"><UserRound size={25}/></span><strong>No active employee is linked to this account</strong><p>Ask an Admin to link your sign-in account to an active employee record.</p></section> : <>
        <div className="employee-welcome"><div className="employee-monogram">{initials(employee.name)}</div><div><span className="eyebrow">Signed-in employee</span><h2>{employee.name}</h2><p>{employee.designation}{employee.designation && employee.department ? ' · ' : ''}{employee.department}</p></div><span className="welcome-count">{incoming.length} assigned</span></div>
        <div className="section-line"><div><h2>Incoming requests</h2><p>Reception request time and latest update appear on every visitor card.</p></div></div>
        {!incoming.length ? <section className="empty-state panel"><span className="empty-art"><ClipboardList size={25}/></span><strong>No requests assigned to {employee.name}</strong><p>Reception requests addressed to this employee will appear here immediately.</p></section> : <div className="incoming-list">{incoming.map(r => <article className="incoming-card" key={r.id} data-testid={`card-incoming-${r.id}`}><div className="incoming-top"><div><span className="eyebrow">Visitor request · {formatDate(r.requestedAt)} at {formatTime(r.requestedAt)}</span><h3>{r.visitorName}</h3><p>{r.company || 'Company not provided'}{r.mobileNumber ? ` · ${r.mobileNumber}` : ''}</p><span className="person-sub">Updated {formatDate(r.updatedAt)} · {formatTime(r.updatedAt)}</span></div><StatusBadge status={r.status}/></div><div className="visitor-detail-grid"><div><span>Purpose</span><strong>{r.purpose}</strong></div><div><span>Visitors</span><strong>{r.visitorCount}</strong></div>{r.idVehicleNumber && <div><span>ID / Vehicle</span><strong>{r.idVehicleNumber}</strong></div>}{r.remarks && <div className="detail-wide"><span>Reception remarks</span><strong>{r.remarks}</strong></div>}</div>
          {requestedStates.includes(r.status) ? <div className="employee-actions"><button className="button" disabled={busyRequestId === r.id} onClick={() => void runEmployeeAction(r.id, 'call')} data-testid={`button-employee-call-in-${r.id}`}>CALL IN</button><button className="button secondary" disabled={busyRequestId === r.id} onClick={() => void runEmployeeAction(r.id, 'wait')} data-testid={`button-employee-wait-${r.id}`}>KEEP WAITING</button><button className="button secondary" onClick={() => beginTransfer(r.id)} disabled={!employee.canTransferRequests || transferTargets.length === 0 || busyRequestId === r.id} data-testid={`button-employee-transfer-${r.id}`}>TRANSFER</button><button className="button danger" disabled={busyRequestId === r.id} onClick={() => void runEmployeeAction(r.id, 'decline')} data-testid={`button-employee-decline-${r.id}`}>DECLINE</button></div> : <div className="readonly-note">No employee action is available for this status. Reception can continue the visit workflow.</div>}
          {transferId === r.id && <div className="transfer-panel"><label htmlFor={`transfer-target-${r.id}`}>Transfer to an approved recipient</label><select id={`transfer-target-${r.id}`} value={transferTarget} onChange={e => setTransferTarget(e.target.value)} data-testid={`select-transfer-target-${r.id}`}><option value="">Choose eligible employee</option>{transferTargets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.designation || t.department || 'Employee'}</option>)}</select><button className="button small" onClick={() => void confirmTransfer()} disabled={!transferTarget || busyRequestId === r.id} data-testid={`button-confirm-transfer-${r.id}`}>Confirm transfer</button><button className="text-button" onClick={() => setTransferId('')} data-testid={`button-cancel-transfer-${r.id}`}>Cancel</button></div>}
        </article>)}</div>}
      </>}
  </>;
}

function HistoryPage({ requests }: { requests: MeetingRequest[] }) {
  const [query, setQuery] = useState(''); const [date, setDate] = useState(''); const [employee, setEmployee] = useState('all'); const [status, setStatus] = useState('all');
  const employees = useMemo(() => [...new Set(requests.flatMap(r => [r.requestedEmployeeName, r.assignedEmployeeName]))], [requests]);
  const filtered = useMemo(() => requests.filter(r => (!query || `${r.visitorName} ${r.mobileNumber}`.toLowerCase().includes(query.toLowerCase())) && (!date || localDateKey(r.requestedAt) === date) && (employee === 'all' || r.requestedEmployeeName === employee || r.assignedEmployeeName === employee) && (status === 'all' || r.status === status)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), [requests, query, date, employee, status]);
  return <><PageHeading eyebrow="Receptionist Panel · records" title="Visitor history" description="Find a visitor by name or mobile, then narrow the record list by date, requested person, or status."/><section className="panel"><div className="toolbar history-toolbar"><div className="filters"><div className="search-box"><Search size={15}/><input aria-label="Search visitor name or mobile" placeholder="Visitor name or mobile" value={query} onChange={e => setQuery(e.target.value)} data-testid="input-history-search"/></div><input className="filter-select date-filter" type="date" aria-label="Filter history by date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-history-date"/><select className="filter-select" aria-label="Filter history by requested employee" value={employee} onChange={e => setEmployee(e.target.value)} data-testid="select-history-employee"><option value="all">All employees</option>{employees.map(e => <option key={e}>{e}</option>)}</select><select className="filter-select" aria-label="Filter history by status" value={status} onChange={e => setStatus(e.target.value)} data-testid="select-history-status"><option value="all">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div><span className="toolbar-count">{filtered.length} records</span></div>
      {filtered.length ? <div className="table-wrap"><table className="history-table"><thead><tr><th>Visitor</th><th>Date</th><th>Time</th><th>Mobile</th><th>Requested person</th><th>Purpose</th><th>Status</th><th>Remarks</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id} data-testid={`row-history-${r.id}`}><td><span className="person-name">{r.visitorName}</span><span className="person-sub">{r.company || 'Company not provided'}</span></td><td>{formatDate(r.requestedAt)}</td><td>{formatTime(r.requestedAt)}</td><td>{r.mobileNumber}</td><td><span className="person-name">{r.requestedEmployeeName}</span>{r.assignedEmployeeId !== r.requestedEmployeeId && <span className="person-sub">Transferred to {r.assignedEmployeeName}</span>}</td><td>{r.purpose}</td><td><StatusBadge status={r.status}/></td><td>{r.remarks || '—'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-art"><History size={25}/></span><strong>{requests.length ? 'No visitors match those filters' : 'Visitor history is empty'}</strong><p>{requests.length ? 'Adjust or clear a filter to see more records.' : 'Completed and current visitor requests will be recorded here automatically.'}</p></div>}</section></>;
}

function AdminHome({ employees, requests }: { employees: Employee[]; requests: MeetingRequest[] }) {
  return <><PageHeading eyebrow="Admin Panel" title="Team & routing overview" description="Configure who can receive visitor requests and which transfer paths are allowed." action={<Link href="/admin/team" className="button" data-testid="button-admin-manage-team"><Users size={14}/>Manage employees</Link>}/>
    <div className="stats-grid"><div className="stat-card"><div className="stat-top">Employees <span className="stat-icon"><Users size={15}/></span></div><div className="stat-value">{employees.length}</div><div className="stat-note">{employees.filter(e => e.active).length} active</div></div><div className="stat-card"><div className="stat-top">Request recipients <span className="stat-icon"><DoorOpen size={15}/></span></div><div className="stat-value">{employees.filter(e => e.active && e.canReceiveRequests).length}</div><div className="stat-note">Active and permitted to receive</div></div><div className="stat-card"><div className="stat-top">Requests <span className="stat-icon"><ClipboardList size={15}/></span></div><div className="stat-value">{requests.length}</div><div className="stat-note">Shared workflow records</div></div></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Employee setup</h2><p className="panel-subtitle">Staff and transfer permissions are managed by Admin.</p></div><Link href="/admin/team" className="text-link">Open management <ArrowRight size={13}/></Link></div>{employees.length ? <div className="team-summary">{employees.slice(0, 5).map(e => <div className="team-summary-row" key={e.id}><Person name={e.name} sub={`${e.designation || 'Employee'}${e.department ? ` · ${e.department}` : ''}`}/><span className={`status ${e.active ? 'accepted' : 'declined'}`}>{e.active ? 'Active' : 'Inactive'}</span></div>)}</div> : <div className="empty-state compact-empty"><Users size={24}/><strong>No employees configured</strong><p>Add only the real staff who need access to this front desk workflow.</p><Link href="/admin/team" className="button secondary">Add an employee</Link></div>}</section><aside className="admin-callout"><span className="callout-icon"><ShieldCheck size={19}/></span><h2>Role-based account access.</h2><p>Manage authorized sign-in accounts and panel roles separately from employee routing permissions.</p><Link href="/admin/users" className="text-link">Manage accounts <ArrowRight size={13}/></Link><div className="callout-rule"/><span>Private passwords</span><small>Password hashes stay on the API server.</small></aside></div>
  </>;
}
function EmployeeForm({ initial, employees, onSave, onCancel }: { initial?: Employee; employees: Employee[]; onSave: (employee: Employee) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<Employee>(initial || { id: crypto.randomUUID(), name: '', designation: '', department: '', loginEmail: '', active: true, canReceiveRequests: true, canTransferRequests: false, transferTo: [] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof Employee, value: string | boolean | string[]) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) { setError('Employee name is required.'); return; }
    try { setSaving(true); await onSave({ ...form, name: form.name.trim(), loginEmail: form.loginEmail.trim() }); setError(''); }
    catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  };
  return <form className="panel staff-form" onSubmit={submit} data-testid="form-employee"><div className="panel-header"><div><h2 className="panel-title">{initial ? 'Edit employee' : 'Add employee'}</h2><p className="panel-subtitle">Manage sign-in accounts separately in Account management.</p></div></div><div className="form-grid">
    <div className="field"><label htmlFor="staff-name">Name <span>*</span></label><input id="staff-name" value={form.name} onChange={e => set('name', e.target.value)} data-testid="input-staff-name" required/></div>
    <div className="field"><label htmlFor="staff-designation">Designation</label><input id="staff-designation" value={form.designation} onChange={e => set('designation', e.target.value)} data-testid="input-staff-designation"/></div>
    <div className="field"><label htmlFor="staff-department">Department</label><input id="staff-department" value={form.department} onChange={e => set('department', e.target.value)} data-testid="input-staff-department"/></div>
    <div className="field"><label htmlFor="staff-email">Contact / login email</label><input id="staff-email" type="text" value={form.loginEmail} onChange={e => set('loginEmail', e.target.value)} autoComplete="off" data-testid="input-staff-identifier"/><small className="field-help">This field is informational; account access is assigned separately.</small></div>
    <div className="permission-grid">
      <label className="permission-option"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} data-testid="checkbox-staff-active"/><span><strong>Active employee</strong><small>Inactive employees cannot receive requests or transfers.</small></span></label>
      <label className="permission-option"><input type="checkbox" checked={form.canReceiveRequests} onChange={e => set('canReceiveRequests', e.target.checked)} data-testid="checkbox-can-receive"/><span><strong>Can receive requests</strong><small>Eligible for the reception intake recipient list.</small></span></label>
      <label className="permission-option"><input type="checkbox" checked={form.canTransferRequests} onChange={e => set('canTransferRequests', e.target.checked)} data-testid="checkbox-can-transfer"/><span><strong>Can transfer requests</strong><small>May route requests to approved targets below.</small></span></label>
    </div>
    <fieldset className="field full transfer-targets"><legend>Allowed transfer targets</legend><p>Only active employees who can receive requests are eligible.</p><div className="target-list">{employees.filter(e => e.id !== form.id && e.active && e.canReceiveRequests).length ? employees.filter(e => e.id !== form.id && e.active && e.canReceiveRequests).map(e => <label key={e.id} className="target-option"><input type="checkbox" checked={form.transferTo.includes(e.id)} onChange={event => set('transferTo', event.target.checked ? [...form.transferTo, e.id] : form.transferTo.filter(x => x !== e.id))} data-testid={`checkbox-transfer-target-${e.id}`}/><span>{e.name}<small>{e.designation || e.department || 'Employee'}</small></span></label>) : <span className="person-sub">Add another active, request-receiving employee to configure a transfer target.</span>}</div></fieldset>
    {error && <div className="field full form-error" role="alert">{error}</div>}</div><div className="form-actions"><button type="button" className="button secondary" onClick={onCancel} data-testid="button-cancel-staff">Cancel</button><button type="submit" className="button" disabled={saving} data-testid="button-save-staff">{saving ? 'Saving…' : initial ? 'Save changes' : 'Add employee'}</button></div></form>;
}
function TeamPage({ employees, saveEmployee, toggleEmployeeActive }: { employees: Employee[]; saveEmployee: (employee: Employee) => Promise<Employee>; toggleEmployeeActive: (employeeId: string) => Promise<Employee> }) {
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined); const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyEmployeeId, setBusyEmployeeId] = useState('');
  const filtered = employees.filter(e => `${e.name} ${e.designation} ${e.department} ${e.loginEmail}`.toLowerCase().includes(query.toLowerCase()));
  const save = async (entry: Employee) => { await saveEmployee(entry); setEditing(undefined); setActionError(''); };
  const toggleActive = async (entry: Employee) => {
    try { setBusyEmployeeId(entry.id); await toggleEmployeeActive(entry.id); setActionError(''); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusyEmployeeId(''); }
  };
  return <><PageHeading eyebrow="Admin Panel · staff access" title="Employee management" description="Maintain team details, receiving permissions, and the exact transfer hierarchy." action={editing === undefined && <button className="button" onClick={() => setEditing(null)} data-testid="button-add-employee"><Plus size={14}/>Add employee</button>}/>
    {editing !== undefined ? <EmployeeForm key={editing?.id || 'new'} initial={editing || undefined} employees={employees} onSave={save} onCancel={() => setEditing(undefined)}/> : <section className="panel">{actionError && <div className="queue-error form-error" role="alert">{actionError}</div>}<div className="toolbar"><div className="filters"><div className="search-box"><Search size={15}/><input aria-label="Search employees" placeholder="Search employees or department" value={query} onChange={e => setQuery(e.target.value)} data-testid="input-team-search"/></div></div><span className="toolbar-count">{filtered.length} employees</span></div>
       {filtered.length ? <div className="table-wrap"><table className="team-table"><thead><tr><th>Employee</th><th>Contact / login email</th><th>Permissions</th><th>Transfer targets</th><th>Access</th><th>Manage</th></tr></thead><tbody>{filtered.map(e => <tr key={e.id} data-testid={`row-employee-${e.id}`}><td><Person name={e.name} sub={`${e.designation || 'Employee'}${e.department ? ` · ${e.department}` : ''}`}/></td><td>{e.loginEmail || <span className="person-sub">Not provided</span>}</td><td><div className="permission-tags"><span>{e.canReceiveRequests ? 'Receives requests' : 'Cannot receive'}</span><span>{e.canTransferRequests ? 'Can transfer' : 'No transfer'}</span></div></td><td>{e.transferTo.map(id => employees.find(x => x.id === id)?.name).filter(Boolean).join(', ') || <span className="person-sub">None allowed</span>}</td><td><span className={`status ${e.active ? 'accepted' : 'declined'}`}>{e.active ? 'Active' : 'Inactive'}</span></td><td><div className="row-actions"><button className="button small secondary" onClick={() => setEditing(e)} data-testid={`button-edit-employee-${e.id}`}>Edit</button><button className={`button small ${e.active ? 'danger' : ''}`} disabled={busyEmployeeId === e.id} onClick={() => void toggleActive(e)} data-testid={`button-toggle-employee-${e.id}`}>{e.active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-art"><Users size={25}/></span><strong>{employees.length ? 'No employees match that search' : 'No employees added yet'}</strong><p>{employees.length ? 'Try another name or department.' : 'Create a staff record for reception routing and link a sign-in account separately.'}</p>{!employees.length && <button className="button secondary" onClick={() => setEditing(null)} data-testid="button-empty-add-employee"><Plus size={14}/>Add the first employee</button>}</div>}</section>}
    <div className="privacy-note admin-privacy"><ShieldCheck size={17}/><span><strong>Account access is managed separately</strong>Link employee-role accounts in Account management. Deactivating an employee also blocks their linked employee account from accessing the panel.</span></div>
  </>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function Router() {
  const [path, setPath] = useLocation();
  const [repository] = useState(() => new ApiReceptionRepository());
  const state = useSyncExternalStore(repository.subscribe, repository.getSnapshot, repository.getSnapshot);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [loadedScope, setLoadedScope] = useState('');
  const userScope = user ? `${user.id}:${user.role}:${user.employeeId || ''}` : '';

  useEffect(() => {
    let active = true;
    Promise.allSettled([getCurrentUser(), getBootstrapStatus()]).then(([sessionResult, bootstrapResult]) => {
      if (!active) return;
      if (sessionResult.status === 'fulfilled') setUser(sessionResult.value);
      else setAuthError(errorText(sessionResult.reason));
      if (bootstrapResult.status === 'fulfilled') setBootstrapStatus(bootstrapResult.value);
      else setAuthError(errorText(bootstrapResult.reason));
      setSessionChecked(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      repository.clear();
      setLoadedScope('');
      return;
    }
    let active = true;
    setLoadedScope('');
    void repository.loadFor(user).then(() => {
      if (active) setLoadedScope(userScope);
    }).catch(() => undefined);
    const interval = window.setInterval(() => {
      if (active) void repository.refresh().catch(() => undefined);
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [repository, userScope]);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!user) {
      if (path === '/setup-admin' && bootstrapStatus?.available) return;
      if (path !== '/login') setPath('/login');
      return;
    }
    if (path === '/login' || path === '/setup-admin' || !roleCanOpenPath(user.role, path)) {
      setPath(homeForRole(user.role));
    }
  }, [path, setPath, sessionChecked, user, bootstrapStatus]);

  const handleLogin = (signedInUser: AuthUser) => {
    setAuthError('');
    setBootstrapStatus({ available: false, requiresToken: false });
    setUser(signedInUser);
    setPath(homeForRole(signedInUser.role));
  };
  const handleLogout = async () => {
    try {
      await signOut();
      repository.clear();
      setUser(null);
      setPath('/login');
      setAuthError('');
    } catch (error) {
      setAuthError(errorText(error));
    }
  };

  if (!sessionChecked) return <div className="auth-loading" role="status">Checking sign-in…</div>;
  if (!user) {
    if (!bootstrapStatus && !authError) return <div className="auth-loading" role="status">Checking first-time setup…</div>;
    if (path === '/setup-admin' && bootstrapStatus?.available) {
      return <FirstAdminSetupPage requiresToken={bootstrapStatus.requiresToken} onCreated={handleLogin}/>;
    }
    return <LoginPage initialSetupAvailable={Boolean(bootstrapStatus?.available)} systemError={authError} onSignIn={handleLogin}/>;
  }

  if (!roleCanOpenPath(user.role, path)) return <div className="auth-loading" role="status">Opening your authorized panel…</div>;
  if (state.error) return <main className="auth-page"><section className="auth-card"><div className="auth-heading"><span className="eyebrow">Shared workspace</span><h1>Data is unavailable</h1><p>{state.error}</p></div><button className="button auth-submit" onClick={() => void repository.refresh()} data-testid="button-retry-data">Retry</button><button className="button secondary auth-secondary" onClick={() => void handleLogout()} data-testid="button-error-logout">Sign out</button></section></main>;
  if (state.loading || loadedScope !== userScope) return <div className="auth-loading" role="status">Loading shared reception data…</div>;

  const { requests, employees } = state;
  const linkedEmployee = user.employeeId ? employees.find(employee => employee.id === user.employeeId) : undefined;
  const updateStatus = (id: string, status: 'Called In' | 'Meeting' | 'Completed') => repository.advanceRequest(id, status);
  const createRequest = (data: NewMeetingRequest) => repository.createRequest(data);
  const employeeAction = (id: string, action: EmployeeAction) => repository.respondToRequest(id, action);
  const transferRequest = (id: string, targetEmployeeId: string) => repository.transferRequest(id, targetEmployeeId);
  return <RoutedErrorBoundary><AppShell user={user} onLogout={handleLogout} requests={requests} employees={employees}>
    {state.migrationWarning && <div className="migration-warning" role="status">{state.migrationWarning}</div>}
    {authError && <div className="queue-error form-error" role="alert">{authError}</div>}
    <Switch>
      <Route path="/"><ReceptionHome requests={requests} employees={employees}/></Route>
      <Route path="/requests/new"><NewRequest employees={employees} onCreate={createRequest}/></Route>
      <Route path="/requests"><QueuePage requests={requests} updateStatus={updateStatus}/></Route>
      <Route path="/history"><HistoryPage requests={requests}/></Route>
      <Route path="/employee"><EmployeePanel employee={linkedEmployee} employees={employees} requests={requests} employeeAction={employeeAction} transferRequest={transferRequest}/></Route>
      <Route path="/admin"><AdminHome employees={employees} requests={requests}/></Route>
      <Route path="/admin/team"><TeamPage employees={employees} saveEmployee={employee => repository.saveEmployee(employee)} toggleEmployeeActive={employeeId => repository.toggleEmployeeActive(employeeId)}/></Route>
      <Route path="/admin/users"><AdminUsersPage currentUser={user} employees={employees} onCurrentUserUpdated={setUser}/></Route>
      <Route component={NotFound}/>
    </Switch>
  </AppShell></RoutedErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;