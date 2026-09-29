import { PrismaClient, UserRole, UserStatus, DevicePlatform, IncidentStatus, IncidentPriority, NotificationPriority, AmbulanceStatus, Gender, PatientStatus, TriageCategory, TriageSource, VitalSource, InventoryCategory, InventoryTxType, DeliveryStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting MedFlow Deterministic Development Seed...');

  // ----------------------------------------------------------------------------
  // 1. IDENTITY: USERS
  // ----------------------------------------------------------------------------
  console.log('  Seeding Users...');
  const paramedic = await prisma.user.upsert({
    where: { phone: '+15550100001' },
    update: {
      displayName: 'Sarah Connor (Lead Paramedic)',
      role: UserRole.PARAMEDIC,
      status: UserStatus.ACTIVE,
    },
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      firebaseUid: 'firebase-paramedic-001',
      phone: '+15550100001',
      displayName: 'Sarah Connor (Lead Paramedic)',
      role: UserRole.PARAMEDIC,
      status: UserStatus.ACTIVE,
    },
  });

  const doctor = await prisma.user.upsert({
    where: { phone: '+15550100002' },
    update: {
      displayName: 'Dr. Marcus Vance (ER Triage Lead)',
      role: UserRole.TRIAGE_DOCTOR,
      status: UserStatus.ACTIVE,
    },
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      firebaseUid: 'firebase-doctor-001',
      phone: '+15550100002',
      displayName: 'Dr. Marcus Vance (ER Triage Lead)',
      role: UserRole.TRIAGE_DOCTOR,
      status: UserStatus.ACTIVE,
    },
  });

  const superintendent = await prisma.user.upsert({
    where: { phone: '+15550100003' },
    update: {
      displayName: 'Chief Elena Rostova (Hospital Superintendent)',
      role: UserRole.HOSPITAL_SUPERINTENDENT,
      status: UserStatus.ACTIVE,
    },
    create: {
      id: '33333333-3333-3333-3333-333333333333',
      firebaseUid: 'firebase-super-001',
      phone: '+15550100003',
      displayName: 'Chief Elena Rostova (Hospital Superintendent)',
      role: UserRole.HOSPITAL_SUPERINTENDENT,
      status: UserStatus.ACTIVE,
    },
  });

  // ----------------------------------------------------------------------------
  // 2. DEVICES & REFRESH TOKENS
  // ----------------------------------------------------------------------------
  console.log('  Seeding Devices & Refresh Tokens...');
  const paramedicDevice = await prisma.device.upsert({
    where: { id: '44444444-4444-4444-4444-444444444441' },
    update: {
      lastActiveAt: new Date(),
      pushToken: 'fcm-token-paramedic-device-01',
    },
    create: {
      id: '44444444-4444-4444-4444-444444444441',
      userId: paramedic.id,
      platform: DevicePlatform.ANDROID,
      appVersion: '1.0.0-dev',
      pushToken: 'fcm-token-paramedic-device-01',
      lastActiveAt: new Date(),
    },
  });

  const doctorDevice = await prisma.device.upsert({
    where: { id: '44444444-4444-4444-4444-444444444442' },
    update: {
      lastActiveAt: new Date(),
      pushToken: 'fcm-token-doctor-tablet-01',
    },
    create: {
      id: '44444444-4444-4444-4444-444444444442',
      userId: doctor.id,
      platform: DevicePlatform.IOS,
      appVersion: '1.0.0-dev',
      pushToken: 'fcm-token-doctor-tablet-01',
      lastActiveAt: new Date(),
    },
  });

  await prisma.refreshToken.upsert({
    where: { hashedToken: 'sha256-hash-sample-paramedic-refresh-token-01' },
    update: {
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      id: '55555555-5555-5555-5555-555555555551',
      userId: paramedic.id,
      deviceId: paramedicDevice.id, // nullable device binding
      hashedToken: 'sha256-hash-sample-paramedic-refresh-token-01',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // ----------------------------------------------------------------------------
  // 3. AMBULANCES & FLEET TELEMETRY
  // ----------------------------------------------------------------------------
  console.log('  Seeding Ambulances & Telemetry...');
  const ambulance1 = await prisma.ambulance.upsert({
    where: { callSign: 'AMB-01' },
    update: { status: AmbulanceStatus.DISPATCHED },
    create: {
      id: '66666666-6666-6666-6666-666666666661',
      callSign: 'AMB-01',
      licensePlate: 'MED-FLOW-01',
      status: AmbulanceStatus.DISPATCHED,
    },
  });

  const ambulance2 = await prisma.ambulance.upsert({
    where: { callSign: 'AMB-02' },
    update: { status: AmbulanceStatus.AVAILABLE },
    create: {
      id: '66666666-6666-6666-6666-666666666662',
      callSign: 'AMB-02',
      licensePlate: 'MED-FLOW-02',
      status: AmbulanceStatus.AVAILABLE,
    },
  });

  const existingLoc = await prisma.locationHistory.findFirst({
    where: { ambulanceId: ambulance1.id },
  });
  if (!existingLoc) {
    await prisma.locationHistory.create({
      data: {
        id: '66666666-6666-6666-6666-666666666671',
        ambulanceId: ambulance1.id,
        latitude: 37.7749,
        longitude: -122.4194,
        speed: 45.5,
        heading: 180.0,
        recordedAt: new Date(),
      },
    });
  }

  // ----------------------------------------------------------------------------
  // 4. INCIDENTS & DISPATCH ASSIGNMENTS
  // ----------------------------------------------------------------------------
  console.log('  Seeding Incidents & Assignments...');
  const incident = await prisma.incident.upsert({
    where: { incidentNumber: 'INC-2026-001' },
    update: {
      status: IncidentStatus.ACTIVE,
      priority: IncidentPriority.CRITICAL,
    },
    create: {
      id: '77777777-7777-7777-7777-777777777777',
      incidentNumber: 'INC-2026-001',
      title: 'Metro Rail Derailment - Central Hub',
      description: 'Multiple train car derailment with reported mass casualties. Structural damage and emergency triage active.',
      status: IncidentStatus.ACTIVE,
      priority: IncidentPriority.CRITICAL,
      latitude: 37.7749,
      longitude: -122.4194,
      address: 'Central Station Platform 3, Metro Transit District',
      reportedAt: new Date(),
      version: 1,
      createdBy: superintendent.id,
    },
  });

  const existingAssignment = await prisma.incidentAssignment.findFirst({
    where: { incidentId: incident.id, userId: paramedic.id },
  });
  if (!existingAssignment) {
    await prisma.incidentAssignment.create({
      data: {
        id: '88888888-8888-8888-8888-888888888881',
        incidentId: incident.id,
        userId: paramedic.id,
        ambulanceId: ambulance1.id,
        assignedAt: new Date(),
        roleInIncident: 'LEAD_PARAMEDIC',
      },
    });
  }

  // ----------------------------------------------------------------------------
  // 5. PATIENTS & CLINICAL OBSERVATIONS (RED, YELLOW, GREEN, BLACK)
  // ----------------------------------------------------------------------------
  console.log('  Seeding Patients & Clinical Assessments...');
  
  // Patient 1: Critical (RED)
  const patientRed = await prisma.patient.upsert({
    where: { demoId: 'DEMO-PT-001' },
    update: {
      status: PatientStatus.IN_TRANSIT,
      currentTriageCategory: TriageCategory.RED,
    },
    create: {
      id: '99999999-9999-9999-9999-999999999901',
      incidentId: incident.id,
      demoId: 'DEMO-PT-001',
      firstName: 'John',
      lastName: 'Doe',
      estimatedAge: 34,
      gender: Gender.MALE,
      status: PatientStatus.IN_TRANSIT,
      currentTriageCategory: TriageCategory.RED,
      chiefComplaint: 'Blunt chest trauma, severe respiratory distress',
      version: 1,
      clientCreatedAt: new Date(),
    },
  });

  // Patient 2: Urgent (YELLOW)
  const patientYellow = await prisma.patient.upsert({
    where: { demoId: 'DEMO-PT-002' },
    update: {
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.YELLOW,
    },
    create: {
      id: '99999999-9999-9999-9999-999999999902',
      incidentId: incident.id,
      demoId: 'DEMO-PT-002',
      firstName: 'Jane',
      lastName: 'Smith',
      estimatedAge: 28,
      gender: Gender.FEMALE,
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.YELLOW,
      chiefComplaint: 'Compound lower extremity fracture, controlled bleeding',
      version: 1,
      clientCreatedAt: new Date(),
    },
  });

  // Patient 3: Minor (GREEN)
  const patientGreen = await prisma.patient.upsert({
    where: { demoId: 'DEMO-PT-003' },
    update: {
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.GREEN,
    },
    create: {
      id: '99999999-9999-9999-9999-999999999903',
      incidentId: incident.id,
      demoId: 'DEMO-PT-003',
      firstName: 'Robert',
      lastName: 'Johnson',
      estimatedAge: 45,
      gender: Gender.MALE,
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.GREEN,
      chiefComplaint: 'Minor lacerations and smoke inhalation, ambulatory',
      version: 1,
      clientCreatedAt: new Date(),
    },
  });

  // Patient 4: Deceased / Expectant (BLACK)
  const patientBlack = await prisma.patient.upsert({
    where: { demoId: 'DEMO-PT-004' },
    update: {
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.BLACK,
    },
    create: {
      id: '99999999-9999-9999-9999-999999999904',
      incidentId: incident.id,
      demoId: 'DEMO-PT-004',
      firstName: 'Unknown',
      lastName: 'Casualty',
      estimatedAge: 52,
      gender: Gender.MALE,
      status: PatientStatus.FIELD_INTAKE,
      currentTriageCategory: TriageCategory.BLACK,
      chiefComplaint: 'Crush injuries, apnea after airway repositioning',
      version: 1,
      clientCreatedAt: new Date(),
    },
  });

  // Patient Vitals (Append-only)
  const existingVitalsRed = await prisma.patientVitalSign.findFirst({
    where: { patientId: patientRed.id },
  });
  if (!existingVitalsRed) {
    await prisma.patientVitalSign.create({
      data: {
        id: '99999999-9999-9999-9999-999999999911',
        patientId: patientRed.id,
        recordedBy: paramedic.id,
        systolicBp: 85,
        diastolicBp: 50,
        heartRate: 135,
        respiratoryRate: 34,
        oxygenSaturation: 88.5,
        temperature: 36.2,
        gcsScore: 11,
        source: VitalSource.PARAMEDIC_FIELD,
        recordedAt: new Date(),
      },
    });
  }

  // Triage Assessments (Append-only, one current per patient)
  const existingTriageRed = await prisma.triageAssessment.findFirst({
    where: { patientId: patientRed.id },
  });
  if (!existingTriageRed) {
    await prisma.triageAssessment.create({
      data: {
        id: '99999999-9999-9999-9999-999999999921',
        patientId: patientRed.id,
        assessedBy: paramedic.id,
        canWalk: false,
        hasRespirations: true,
        respiratoryRate: 34, // > 30 -> RED
        radialPulse: true,
        capillaryRefillSec: 3.5,
        followsCommands: false,
        calculatedCategory: TriageCategory.RED,
        isCurrent: true,
        assessmentSource: TriageSource.FIELD_START,
        assessedAt: new Date(),
      },
    });
  }

  const existingTriageYellow = await prisma.triageAssessment.findFirst({
    where: { patientId: patientYellow.id },
  });
  if (!existingTriageYellow) {
    await prisma.triageAssessment.create({
      data: {
        id: '99999999-9999-9999-9999-999999999922',
        patientId: patientYellow.id,
        assessedBy: paramedic.id,
        canWalk: false,
        hasRespirations: true,
        respiratoryRate: 22,
        radialPulse: true,
        capillaryRefillSec: 1.8,
        followsCommands: true,
        calculatedCategory: TriageCategory.YELLOW,
        isCurrent: true,
        assessmentSource: TriageSource.FIELD_START,
        assessedAt: new Date(),
      },
    });
  }

  const existingTriageGreen = await prisma.triageAssessment.findFirst({
    where: { patientId: patientGreen.id },
  });
  if (!existingTriageGreen) {
    await prisma.triageAssessment.create({
      data: {
        id: '99999999-9999-9999-9999-999999999923',
        patientId: patientGreen.id,
        assessedBy: paramedic.id,
        canWalk: true, // Walkable -> GREEN
        hasRespirations: true,
        respiratoryRate: 18,
        radialPulse: true,
        capillaryRefillSec: 1.5,
        followsCommands: true,
        calculatedCategory: TriageCategory.GREEN,
        isCurrent: true,
        assessmentSource: TriageSource.FIELD_START,
        assessedAt: new Date(),
      },
    });
  }

  const existingTriageBlack = await prisma.triageAssessment.findFirst({
    where: { patientId: patientBlack.id },
  });
  if (!existingTriageBlack) {
    await prisma.triageAssessment.create({
      data: {
        id: '99999999-9999-9999-9999-999999999924',
        patientId: patientBlack.id,
        assessedBy: paramedic.id,
        canWalk: false,
        hasRespirations: false, // Apneic -> BLACK
        respiratoryRate: 0,
        radialPulse: false,
        capillaryRefillSec: 0,
        followsCommands: false,
        calculatedCategory: TriageCategory.BLACK,
        isCurrent: true,
        assessmentSource: TriageSource.FIELD_START,
        assessedAt: new Date(),
      },
    });
  }

  // ----------------------------------------------------------------------------
  // 6. INVENTORY ITEMS & TRANSACTIONS
  // ----------------------------------------------------------------------------
  console.log('  Seeding Hospital Inventory...');
  const bedItem = await prisma.inventoryItem.upsert({
    where: { name: 'ICU Trauma Bed' },
    update: {
      quantityTotal: 10,
      quantityAvailable: 8,
      quantityReserved: 2,
    },
    create: {
      id: 'aaaa1111-1111-1111-1111-111111111111',
      name: 'ICU Trauma Bed',
      category: InventoryCategory.BED,
      unit: 'bed',
      quantityTotal: 10,
      quantityAvailable: 8,
      quantityReserved: 2,
      lowStockThreshold: 2,
      version: 1,
    },
  });

  const oxygenItem = await prisma.inventoryItem.upsert({
    where: { name: 'Medical Oxygen Cylinder (E-Tank)' },
    update: {
      quantityTotal: 50,
      quantityAvailable: 45,
      quantityReserved: 5,
    },
    create: {
      id: 'aaaa2222-2222-2222-2222-222222222222',
      name: 'Medical Oxygen Cylinder (E-Tank)',
      category: InventoryCategory.OXYGEN,
      unit: 'cylinder',
      quantityTotal: 50,
      quantityAvailable: 45,
      quantityReserved: 5,
      lowStockThreshold: 10,
      version: 1,
    },
  });

  const medicationItem = await prisma.inventoryItem.upsert({
    where: { name: 'Epinephrine Auto-Injector 0.3mg' },
    update: {
      quantityTotal: 100,
      quantityAvailable: 90,
      quantityReserved: 10,
    },
    create: {
      id: 'aaaa3333-3333-3333-3333-333333333333',
      name: 'Epinephrine Auto-Injector 0.3mg',
      category: InventoryCategory.MEDICATION,
      unit: 'ampule',
      quantityTotal: 100,
      quantityAvailable: 90,
      quantityReserved: 10,
      lowStockThreshold: 20,
      version: 1,
    },
  });

  const existingTx = await prisma.inventoryTransaction.findFirst({
    where: { itemId: bedItem.id },
  });
  if (!existingTx) {
    await prisma.inventoryTransaction.create({
      data: {
        id: 'aaaa1111-1111-1111-1111-111111111121',
        itemId: bedItem.id,
        userId: superintendent.id,
        patientId: patientRed.id,
        transactionType: InventoryTxType.RESERVED,
        quantityDelta: 2,
        previousAvailable: 10,
        newAvailable: 8,
        reason: 'Reserved 2 ICU beds for inbound critical rail derailment casualties',
        requestId: 'REQ-DISPATCH-001',
      },
    });
  }

  // ----------------------------------------------------------------------------
  // 7. NOTIFICATIONS & DELIVERIES
  // ----------------------------------------------------------------------------
  console.log('  Seeding Notifications & Deliveries...');
  const notification = await prisma.notification.upsert({
    where: { id: 'bbbb1111-1111-1111-1111-111111111111' },
    update: { priority: NotificationPriority.CRITICAL },
    create: {
      id: 'bbbb1111-1111-1111-1111-111111111111',
      priority: NotificationPriority.CRITICAL,
      title: 'MASS CASUALTY ALERT: Metro Rail Derailment',
      body: 'Disaster command activated. All ER units report to triage bays immediately.',
      category: 'MASS_CASUALTY',
      entityType: 'INCIDENT',
      entityId: incident.id,
      deepLink: `/incidents/${incident.id}`,
    },
  });

  await prisma.notificationDelivery.upsert({
    where: { id: 'cccc1111-1111-1111-1111-111111111111' },
    update: { status: DeliveryStatus.DELIVERED },
    create: {
      id: 'cccc1111-1111-1111-1111-111111111111',
      notificationId: notification.id,
      recipientUserId: paramedic.id,
      deviceId: paramedicDevice.id,
      status: DeliveryStatus.DELIVERED,
      fcmMessageId: 'fcm-msg-paramedic-001',
      sentAt: new Date(),
      deliveredAt: new Date(),
    },
  });

  await prisma.notificationDelivery.upsert({
    where: { id: 'cccc2222-2222-2222-2222-222222222222' },
    update: { status: DeliveryStatus.QUEUED },
    create: {
      id: 'cccc2222-2222-2222-2222-222222222222',
      notificationId: notification.id,
      recipientUserId: doctor.id,
      deviceId: doctorDevice.id,
      status: DeliveryStatus.QUEUED,
    },
  });

  // ----------------------------------------------------------------------------
  // 8. DOMAIN EVENTS & AUDIT LOGS
  // ----------------------------------------------------------------------------
  console.log('  Seeding Domain Events & Audit Logs...');
  const existingEvent = await prisma.domainEvent.findFirst({
    where: { aggregateId: incident.id },
  });
  if (!existingEvent) {
    await prisma.domainEvent.create({
      data: {
        id: 'dddd1111-1111-1111-1111-111111111111',
        eventType: 'incident.created',
        aggregateType: 'INCIDENT',
        aggregateId: incident.id,
        incidentId: incident.id,
        userId: superintendent.id,
        payload: {
          incidentNumber: incident.incidentNumber,
          severity: 'CRITICAL',
          casualtyEstimate: '10+',
        },
        occurredAt: new Date(),
      },
    });
  }

  const existingAudit = await prisma.auditLog.findFirst({
    where: { entityId: incident.id },
  });
  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        id: 'eeee1111-1111-1111-1111-111111111111',
        actorUserId: superintendent.id,
        actorRole: 'HOSPITAL_SUPERINTENDENT',
        action: 'CREATE_INCIDENT',
        entityType: 'INCIDENT',
        entityId: incident.id,
        ipAddress: '127.0.0.1',
        userAgent: 'MedFlow-Seed-Engine/1.0',
        metadata: {
          actionRationale: 'Initial development database seed initialization',
          incidentNumber: incident.incidentNumber,
        },
      },
    });
  }

  console.log('✅ MedFlow Development Seed Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error executing MedFlow seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
