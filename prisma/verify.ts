import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPECTED_TABLES = [
  'users',
  'devices',
  'refresh_tokens',
  'incidents',
  'incident_assignments',
  'ambulances',
  'location_history',
  'patients',
  'patient_vitals',
  'patient_media',
  'triage_assessments',
  'inventory_items',
  'inventory_transactions',
  'notifications',
  'notification_deliveries',
  'audit_logs',
  'domain_events',
  'sync_history',
];

const EXPECTED_ENUMS = [
  'enum_user_role',
  'enum_user_status',
  'enum_device_platform',
  'enum_incident_status',
  'enum_incident_priority',
  'enum_notification_priority',
  'enum_ambulance_status',
  'enum_gender',
  'enum_patient_status',
  'enum_triage_category',
  'enum_triage_source',
  'enum_vital_source',
  'enum_media_type',
  'enum_media_status',
  'enum_inventory_category',
  'enum_inventory_tx_type',
  'enum_delivery_status',
  'enum_sync_entity_type',
  'enum_sync_op_type',
  'enum_sync_status',
];

const EXPECTED_CHECK_CONSTRAINTS = [
  'chk_incidents_lat',
  'chk_incidents_lng',
  'chk_incidents_version',
  'chk_loc_lat',
  'chk_loc_lng',
  'chk_patient_estimated_age',
  'chk_vitals_systolic_bp',
  'chk_vitals_heart_rate',
  'chk_vitals_oxygen_saturation',
  'chk_inventory_qty_total',
  'chk_inventory_qty_available',
  'chk_inventory_qty_reserved',
  'chk_inventory_qty_balance',
  'chk_inventory_version',
  'chk_sync_payload_size',
];

const EXPECTED_TRIGGERS = [
  'trg_audit_logs_immutable',
  'trg_patient_vitals_immutable',
  'trg_triage_assessments_immutable',
  'trg_inventory_transactions_immutable',
  'trg_domain_events_immutable',
];

async function verify() {
  console.log('🔍 Starting MedFlow Database Schema & Feature Verification...\n');
  let hasErrors = false;

  // 1. Verify All 18 Tables Exist
  console.log('--- 1. Verifying PostgreSQL Tables (Expected 18 Tables) ---');
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  `;
  const tableNames = new Set(tables.map((t) => t.table_name));

  for (const table of EXPECTED_TABLES) {
    if (tableNames.has(table)) {
      console.log(`  ✓ Table exists: ${table}`);
    } else {
      console.error(`  ✗ MISSING Table: ${table}`);
      hasErrors = true;
    }
  }
  console.log(`Total Tables Verified: ${tableNames.size} (Expected: ${EXPECTED_TABLES.length})\n`);

  // 2. Verify Domain Enums
  console.log('--- 2. Verifying Native PostgreSQL Enums (Expected 20 Enums) ---');
  const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT typname 
    FROM pg_type 
    WHERE typtype = 'e';
  `;
  const enumNames = new Set(enums.map((e) => e.typname));

  for (const enumName of EXPECTED_ENUMS) {
    if (enumNames.has(enumName)) {
      console.log(`  ✓ Enum exists: ${enumName}`);
    } else {
      console.error(`  ✗ MISSING Enum: ${enumName}`);
      hasErrors = true;
    }
  }
  console.log('');

  // 3. Verify Partial Unique Current Triage Index
  console.log('--- 3. Verifying Partial Unique Indexes ---');
  const partialIndex = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'triage_assessments' AND indexname = 'uq_triage_assessments_current_patient';
  `;

  if (partialIndex.length > 0 && partialIndex[0].indexdef.includes('is_current = true')) {
    console.log(`  ✓ Partial Unique Index Verified: uq_triage_assessments_current_patient`);
    console.log(`    Definition: ${partialIndex[0].indexdef}`);
  } else {
    console.error(`  ✗ MISSING OR INVALID Partial Unique Index: uq_triage_assessments_current_patient`);
    hasErrors = true;
  }

  const unreadIndex = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'notification_deliveries' AND indexname = 'idx_notification_deliveries_unread';
  `;
  if (unreadIndex.length > 0) {
    console.log(`  ✓ Unread Notifications Partial Index Verified: idx_notification_deliveries_unread`);
  } else {
    console.error(`  ✗ MISSING Index: idx_notification_deliveries_unread`);
    hasErrors = true;
  }
  console.log('');

  // 4. Verify CHECK Constraints
  console.log('--- 4. Verifying CHECK Constraints ---');
  const constraints = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE constraint_type = 'CHECK' AND table_schema = 'public';
  `;
  const constraintNames = new Set(constraints.map((c) => c.constraint_name));

  for (const c of EXPECTED_CHECK_CONSTRAINTS) {
    if (constraintNames.has(c)) {
      console.log(`  ✓ CHECK Constraint verified: ${c}`);
    } else {
      console.error(`  ✗ MISSING CHECK Constraint: ${c}`);
      hasErrors = true;
    }
  }
  console.log('');

  // 5. Verify Immutability Triggers
  console.log('--- 5. Verifying Database Immutability Triggers ---');
  const triggers = await prisma.$queryRaw<Array<{ trigger_name: string; event_object_table: string }>>`
    SELECT trigger_name, event_object_table 
    FROM information_schema.triggers 
    WHERE trigger_schema = 'public';
  `;
  const triggerNames = new Set(triggers.map((t) => t.trigger_name));

  for (const trg of EXPECTED_TRIGGERS) {
    if (triggerNames.has(trg)) {
      console.log(`  ✓ Trigger verified: ${trg}`);
    } else {
      console.error(`  ✗ MISSING Trigger: ${trg}`);
      hasErrors = true;
    }
  }
  console.log('');

  // 6. Verify Foreign Key on refresh_tokens.device_id -> devices.id
  console.log('--- 6. Verifying refresh_tokens.device_id Foreign Key ---');
  const fkCheck = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'refresh_tokens' 
      AND constraint_type = 'FOREIGN KEY' 
      AND constraint_name = 'refresh_tokens_device_id_fkey';
  `;
  if (fkCheck.length > 0) {
    console.log(`  ✓ Foreign Key Verified: refresh_tokens_device_id_fkey -> devices(id)`);
  } else {
    console.error(`  ✗ MISSING Foreign Key: refresh_tokens_device_id_fkey`);
    hasErrors = true;
  }
  console.log('');

  // 7. Verify Seed Data Presence
  console.log('--- 7. Verifying Demo Data Presence ---');
  const userCount = await prisma.user.count();
  const incidentCount = await prisma.incident.count();
  const patientCount = await prisma.patient.count();
  const ambulanceCount = await prisma.ambulance.count();
  const inventoryCount = await prisma.inventoryItem.count();
  const notificationCount = await prisma.notification.count();

  console.log(`  Users: ${userCount}`);
  console.log(`  Ambulances: ${ambulanceCount}`);
  console.log(`  Incidents: ${incidentCount}`);
  console.log(`  Patients: ${patientCount}`);
  console.log(`  Inventory Items: ${inventoryCount}`);
  console.log(`  Notifications: ${notificationCount}`);

  if (hasErrors) {
    console.error('\n❌ DATABASE VERIFICATION FAILED: One or more required features are missing!');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL DATABASE FEATURES, CONSTRAINTS, INDEXES & TRIGGERS VERIFIED SUCCESSFULLY!');
  }
}

verify()
  .catch((err) => {
    console.error('Fatal verification error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
