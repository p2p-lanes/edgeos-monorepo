---
name: roles-and-users
description: Add teammates to the backoffice, change their role, and understand what each role can do.
triggers: add user,new user,invite teammate,invite admin,team member,add admin,add operator,give access,role,roles,permission,permissions,why can't i,cant edit,can't edit,read only,read-only,viewer,operator,admin,superadmin,check in controller,scanner,login,log in,verification code,otp,agregar usuario,rol,permisos
routes: /admin,/admin/new,/admin/$id/edit,/login,/settings
roles: operator
---
**Where:** Sidebar → "Administration" → "Users" ([Users](/admin)).

**Requires:** Operator or above.
- Operators only see and create "Viewer" and "Check In Controller" users.
- Admins can assign any role except "Superadmin".

**Roles:**
- "Superadmin": "Full platform access".
- "Admin": "Full organization access". Can edit theme, venues, event settings, activity log and third-party apps.
- "Operator": "Day-to-day product operations". Creates and edits gatherings, products, applications, events and tickets, and uses Ask EdgeOS. Cannot edit venues, event settings or theme.
- "Viewer": "Read-only access". Forms become read-only and buttons turn into "Back".
- "Check In Controller": "Scanner access only". For people who scan tickets at the door; read-only in the backoffice.

**Add a user:**
1. Go to [Users](/admin) and click "+ Add User".
2. Fill in "Full Name" and "Email".
3. Click the role badge to pick a role. The default is Viewer.
4. Click "Create User".

No invitation email or password is sent. Tell the person to open the backoffice and log in with their email. They will receive a 6-digit code.

**Change a role:**
1. In [Users](/admin), click the user.
2. Pick a new role and click "Save Changes". The email cannot be changed.

**Delete a user:** Open the user, go to the "Danger Zone" and click "Delete User".

**Login help (/login):**
1. Enter the email and click "Send Verification Code".
2. Enter the 6-digit code and click "Verify and Log In".
3. If no code arrives, check spam. "Resend code" works after 60 seconds, and "Use a different email" changes the address.

**Gotchas:**
- You cannot change your own role ("(cannot change own role)").
- There is no separate roles page. Roles are set on each user.
- Your own name is edited in the sidebar user menu → "User Settings" ([Settings](/settings)).
