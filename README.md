# MRO Planner React

A React-based MRO (Maintenance, Repair, and Overhaul) planning application for managing aircraft visit schedules and resource allocation.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL)

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│                                                                             │
│  ┌─────────────────────┐              ┌─────────────────────┐              │
│  │   Visit Intake      │              │   Visits Manager    │              │
│  │   (Create New)      │              │   (View/Edit/Delete)│              │
│  └──────────┬──────────┘              └──────────┬──────────┘              │
└─────────────┼────────────────────────────────────┼──────────────────────────┘
              │                                    │
              ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                                   │
│                                                                             │
│  src/lib/visitData.ts                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WRITE Operations:                    READ Operations:               │   │
│  │  • createVisit()  ──────┐            ┌────── getAllVisits()         │   │
│  │  • updateVisit()  ──────┼── INSERT   │       getVisitById()         │   │
│  │  • deleteVisit()  ──────┘   DELETE   │                              │   │
│  └─────────────────────────────┼────────┼──────────────────────────────┘   │
└────────────────────────────────┼────────┼───────────────────────────────────┘
                                 │        │
                                 ▼        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPABASE (PostgreSQL)                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      visit_details (TABLE)                          │   │
│  │  ══════════════════════════════════════════════════════════════════ │   │
│  │  Primary data store for all visit information                       │   │
│  │                                                                     │   │
│  │  Columns:                                                           │   │
│  │  • visit_number (PK)     • tail_num          • start_date           │   │
│  │  • end_date              • aircraft_clean    • engine_clean         │   │
│  │  • lic                   • airline/customer  • bay                  │   │
│  │  • min_engineers         • min_technicians   • check_type           │   │
│  │  • po_confirmed          • po_number         • notes                │   │
│  │  • license_authorities   • tooling_constraints                      │   │
│  │  • daywise_resc (JSONB)  • bay_daywise (JSONB)                      │   │
│  │  • date_created          • record_timestamp                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │               visit_planning_combined (VIEW)                        │   │
│  │  ══════════════════════════════════════════════════════════════════ │   │
│  │  Read-only view that:                                               │   │
│  │  • Aliases columns to frontend-friendly names                       │   │
│  │  • Computes status dynamically (Upcoming/Ongoing/Completed)         │   │
│  │  • Provides default values via COALESCE                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Operations Summary

| Operation | Target | Description |
|-----------|--------|-------------|
| **CREATE** | `visit_details` | New visits inserted directly |
| **UPDATE** | `visit_details` | New record inserted (append-only pattern) |
| **DELETE** | `visit_details` | Records deleted by `visit_number` |
| **READ** | `visit_planning_combined` | View provides aliased columns + computed status |

## Key Data Fields

### Visit Details Table (`visit_details`)

| Column | Type | Description |
|--------|------|-------------|
| `visit_number` | INT | Primary key, unique visit identifier |
| `tail_num` | TEXT | Aircraft tail number |
| `start_date` | DATE | Induction date |
| `end_date` | DATE | ETS (Estimated Time of Service) date |
| `aircraft_clean` | TEXT | Aircraft type |
| `engine_clean` | TEXT | Engine type |
| `lic` | TEXT | License requirements (comma-separated) |
| `check_type` | TEXT | A-Check, C-Check, Periodic Check, etc. |
| `min_engineers` | INT | Minimum engineers required |
| `min_technicians` | INT | Minimum technicians required |
| `daywise_resc` | JSONB | Day-wise resource requirements `{"2022-04-30": 3}` |
| `bay_daywise` | JSONB | Day-wise bay allocation `{"2022-04-30": "bay19"}` |

### Check Types

| Check Type | Typical Duration | Description |
|------------|------------------|-------------|
| A-Check | 1-3 days | Light inspection |
| 7 Days Check | 4-7 days | Weekly check |
| Periodic Check | 8-14 days | Regular maintenance |
| C-Check | 15-28 days | Heavy maintenance |
| HSC Check | 29-42 days | Heavy Structural Check |
| 12 Year Check | 43+ days | Major overhaul |

### Visit Status (Computed)

Status is calculated dynamically based on current date (fixed to April 30, 2022) and visit dates:

- **Upcoming**: Current date < Induction date
- **Ongoing**: Induction date <= Current date <= ETS date
- **Completed**: Current date > ETS date

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Environment Variables

Create a `.env` file with:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```