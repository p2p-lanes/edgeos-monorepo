---
name: navigation-and-workspace
description: Find pages in the backoffice sidebar and pick the organization and gathering that every page works on.
triggers: navigate,menu,sidebar,switch gathering,change gathering,select gathering,workspace,no data,empty,i don't see,can't see,cant see,missing,organization,popup,festival,event,command palette,no veo,cambiar gathering
routes: /
roles: viewer
---
**Where:** The left sidebar. Its top group, "Workspace", holds the context selectors. Below it are the sections "Gathering Management", "Registrations", "Events", "Administration" and "Agentic access".

**Requires:** A login. Most pages also need a selected gathering.

**Steps to pick the gathering:**
1. Open the "Gathering" dropdown at the top of the sidebar ("Select gathering").
2. Pick the gathering. The first one is selected automatically if none was chosen.
3. Superadmins first pick an "Organization" ("Select organization"). Until then the gathering slot says "Select an organization first".

**Finding a page:** Use the navigation map, or press ⌘K (Ctrl+K) to open the command palette and type the page name.

**Gotchas:**
- If a page shows "Select a gathering" / "Please select a gathering from the sidebar to view …", no gathering is selected.
- Empty lists usually mean the wrong gathering is selected. Check the selector before assuming data is missing.
- Switching gathering while a form has unsaved edits opens "Unsaved changes" ("Stay on page" / "Discard changes"). After switching, you land back on the list page.
- "Humans" and "Badges" are organization-wide, not per gathering.
- The sidebar hides the Workspace selector when collapsed. Expand it with the toggle in the header.
- Some sections depend on role: "Administration" is operator and above, "Agentic access" is admin and above.
