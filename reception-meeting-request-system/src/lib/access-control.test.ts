import assert from "node:assert/strict";
import test from "node:test";
import { homeForRole, roleCanOpenPath } from "./access-control.ts";

test("Receptionist accounts cannot open employee or Admin panels", () => {
  assert.equal(roleCanOpenPath("Receptionist", "/"), true);
  assert.equal(roleCanOpenPath("Receptionist", "/requests/new"), true);
  assert.equal(roleCanOpenPath("Receptionist", "/history"), true);
  assert.equal(roleCanOpenPath("Receptionist", "/employee"), false);
  assert.equal(roleCanOpenPath("Receptionist", "/admin"), false);
  assert.equal(roleCanOpenPath("Receptionist", "/admin/users"), false);
});

test("employee roles can open only their assigned employee panel", () => {
  for (const role of ["MD", "COO", "President", "Employee"] as const) {
    assert.equal(homeForRole(role), "/employee");
    assert.equal(roleCanOpenPath(role, "/employee"), true);
    assert.equal(roleCanOpenPath(role, "/"), false);
    assert.equal(roleCanOpenPath(role, "/admin/team"), false);
  }
});

test("Admin accounts cannot open Reception or employee panels", () => {
  assert.equal(homeForRole("Admin"), "/admin");
  assert.equal(roleCanOpenPath("Admin", "/admin"), true);
  assert.equal(roleCanOpenPath("Admin", "/admin/team"), true);
  assert.equal(roleCanOpenPath("Admin", "/admin/users"), true);
  assert.equal(roleCanOpenPath("Admin", "/"), false);
  assert.equal(roleCanOpenPath("Admin", "/employee"), false);
});