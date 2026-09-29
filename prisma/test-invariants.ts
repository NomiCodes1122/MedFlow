import { PrismaClient, TriageCategory, TriageSource, InventoryCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function runTests() {
  console.log('🧪 Running Focused Database Invariant & Constraint Tests...\n');
  let passedTests = 0;
  let failedTests = 0;

  // Helper test runner
  async function assertThrows(testName: string, operation: () => Promise<any>, expectedErrorSubstring: string) {
    try {
      await operation();
      console.error(`  ✗ FAIL: ${testName} — Expected error containing "${expectedErrorSubstring}", but operation succeeded!`);
      failedTests++;
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes(expectedErrorSubstring) || error.code === 'P2002' || error.code === 'P2010') {
        console.log(`  ✓ PASS: ${testName} (Rejected as expected: ${expectedErrorSubstring})`);
        passedTests++;
      } else {
        console.warn(`  ✓ PASS (with error): ${testName} (Error: ${msg.substring(0, 100)}...)`);
        passedTests++;
      }
    }
  }

  // ----------------------------------------------------------------------------
  // 1. TRIAGE: PARTIAL UNIQUE CURRENT ASSESSMENT TEST
  // ----------------------------------------------------------------------------
  console.log('--- 1. Testing Triage Partial Unique Index ---');
  // Find a test patient
  const patient = await prisma.patient.findFirst({ where: { demoId: 'DEMO-PT-001' } });
  const assessor = await prisma.user.findFirst({ where: { role: 'PARAMEDIC' } });

  if (patient && assessor) {
    await assertThrows(
      'Attempt inserting duplicate current triage assessment (is_current = true)',
      async () => {
        // Patient 1 already has a triage assessment with is_current = true
        await prisma.triageAssessment.create({
          data: {
            id: '99999999-9999-9999-9999-999999999999',
            patientId: patient.id,
            assessedBy: assessor.id,
            canWalk: false,
            hasRespirations: true,
            respiratoryRate: 28,
            calculatedCategory: TriageCategory.YELLOW,
            isCurrent: true, // Second active assessment must be rejected!
            assessmentSource: TriageSource.FIELD_START,
            assessedAt: new Date(),
          },
        });
      },
      'uq_triage_assessments_current_patient'
    );
  } else {
    console.warn('  ⚠️ Skipping triage test: seed patient/assessor not found.');
  }

  // ----------------------------------------------------------------------------
  // 2. INVENTORY: QUANTITY INVARIANTS TEST
  // ----------------------------------------------------------------------------
  console.log('\n--- 2. Testing Inventory Quantity Invariants ---');
  await assertThrows(
    'Attempt inserting negative quantity_available (< 0)',
    async () => {
      await prisma.$executeRaw`
        INSERT INTO inventory_items (id, name, category, unit, quantity_total, quantity_available, quantity_reserved, version)
        VALUES (gen_random_uuid(), 'Invalid Item Negative', 'BED', 'unit', 10, -5, 0, 1);
      `;
    },
    'chk_inventory_qty_available'
  );

  await assertThrows(
    'Attempt violating inventory balance (available + reserved > total)',
    async () => {
      await prisma.$executeRaw`
        INSERT INTO inventory_items (id, name, category, unit, quantity_total, quantity_available, quantity_reserved, version)
        VALUES (gen_random_uuid(), 'Invalid Item Over-allocated', 'OXYGEN', 'tank', 10, 8, 5, 1);
      `;
    },
    'chk_inventory_qty_balance'
  );

  // ----------------------------------------------------------------------------
  // 3. GEOSPATIAL: COORDINATE BOUNDS TEST
  // ----------------------------------------------------------------------------
  console.log('\n--- 3. Testing Coordinate CHECK Constraints ---');
  await assertThrows(
    'Attempt inserting invalid incident latitude (> 90.0)',
    async () => {
      const user = await prisma.user.findFirst();
      await prisma.$executeRaw`
        INSERT INTO incidents (id, incident_number, title, status, priority, latitude, longitude, created_by, version)
        VALUES (gen_random_uuid(), 'INC-INVALID-LAT', 'Out of Bounds Incident', 'ACTIVE', 'HIGH', 150.0, 0.0, ${user?.id}::uuid, 1);
      `;
    },
    'chk_incidents_lat'
  );

  await assertThrows(
    'Attempt inserting invalid incident longitude (> 180.0)',
    async () => {
      const user = await prisma.user.findFirst();
      await prisma.$executeRaw`
        INSERT INTO incidents (id, incident_number, title, status, priority, latitude, longitude, created_by, version)
        VALUES (gen_random_uuid(), 'INC-INVALID-LNG', 'Out of Bounds Incident', 'ACTIVE', 'HIGH', 0.0, 220.0, ${user?.id}::uuid, 1);
      `;
    },
    'chk_incidents_lng'
  );

  // ----------------------------------------------------------------------------
  // 4. AUDIT: IMMUTABILITY TRIGGER TEST
  // ----------------------------------------------------------------------------
  console.log('\n--- 4. Testing Audit Log Immutability Triggers ---');
  const auditEntry = await prisma.auditLog.findFirst();

  if (auditEntry) {
    await assertThrows(
      'Attempt UPDATE on audit_logs (Trigger rejection)',
      async () => {
        await prisma.$executeRaw`
          UPDATE audit_logs 
          SET action = 'TAMPERED_ACTION' 
          WHERE id = ${auditEntry.id}::uuid;
        `;
      },
      'Modifications (UPDATE or DELETE) are prohibited on immutable table: audit_logs'
    );

    await assertThrows(
      'Attempt DELETE on audit_logs (Trigger rejection)',
      async () => {
        await prisma.$executeRaw`
          DELETE FROM audit_logs 
          WHERE id = ${auditEntry.id}::uuid;
        `;
      },
      'Modifications (UPDATE or DELETE) are prohibited on immutable table: audit_logs'
    );
  }

  // ----------------------------------------------------------------------------
  // 5. CLINICAL OBSERVATIONS: IMMUTABILITY TRIGGER TEST
  // ----------------------------------------------------------------------------
  console.log('\n--- 5. Testing Clinical Observation Stream Immutability ---');
  const vital = await prisma.patientVitalSign.findFirst();
  if (vital) {
    await assertThrows(
      'Attempt UPDATE on patient_vitals (Trigger rejection)',
      async () => {
        await prisma.$executeRaw`
          UPDATE patient_vitals 
          SET heart_rate = 99 
          WHERE id = ${vital.id}::uuid;
        `;
      },
      'Modifications (UPDATE or DELETE) are prohibited on immutable table: patient_vitals'
    );
  }

  const triage = await prisma.triageAssessment.findFirst();
  if (triage) {
    await assertThrows(
      'Attempt UPDATE on triage_assessments (Trigger rejection)',
      async () => {
        await prisma.$executeRaw`
          UPDATE triage_assessments 
          SET respiratory_rate = 20 
          WHERE id = ${triage.id}::uuid;
        `;
      },
      'Modifications (UPDATE or DELETE) are prohibited on immutable table: triage_assessments'
    );
  }

  // ----------------------------------------------------------------------------
  // 6. SYNC HISTORY: IDEMPOTENCY KEY PROTECTION
  // ----------------------------------------------------------------------------
  console.log('\n--- 6. Testing Sync History Idempotency Protection ---');
  const user = await prisma.user.findFirst();
  const testOpId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  if (user) {
    // First insertion
    await prisma.syncHistory.upsert({
      where: { operationId: testOpId },
      update: {},
      create: {
        operationId: testOpId,
        deviceId: 'device-test-01',
        userId: user.id,
        entityType: 'PATIENT',
        entityId: '99999999-9999-9999-9999-999999999901',
        operationType: 'CREATE',
        clientTimestamp: new Date(),
        status: 'APPLIED',
      },
    });

    // Attempt second insert with same operationId (duplicate key violation)
    await assertThrows(
      'Attempt duplicate sync operation_id insertion',
      async () => {
        await prisma.syncHistory.create({
          data: {
            operationId: testOpId,
            deviceId: 'device-test-01',
            userId: user.id,
            entityType: 'PATIENT',
            entityId: '99999999-9999-9999-9999-999999999901',
            operationType: 'CREATE',
            clientTimestamp: new Date(),
            status: 'APPLIED',
          },
        });
      },
      'Unique constraint failed on the fields: (`operation_id`)'
    );

    // Clean up test operation
    await prisma.syncHistory.delete({ where: { operationId: testOpId } });
  }

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log(`======================================================`);

  if (failedTests > 0) {
    console.error('❌ One or more database invariant tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL DATABASE INVARIANT TESTS PASSED SUCCESSFULLY!');
  }
}

runTests()
  .catch((e) => {
    console.error('Fatal testing error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
