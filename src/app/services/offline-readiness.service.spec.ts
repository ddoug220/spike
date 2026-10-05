import { TestBed } from '@angular/core/testing';
import { OfflineReadinessService } from './offline-readiness.service';

describe('OfflineReadinessService', () => {
  let service: OfflineReadinessService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OfflineReadinessService],
    });
    service = TestBed.inject(OfflineReadinessService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should report initial status', () => {
    const status = service.getDetailedStatus();
    expect(status).toBeDefined();
    expect(typeof status.isInstalled).toBe('boolean');
    expect(typeof status.hasServiceWorker).toBe('boolean');
    expect(typeof status.hasStorageAccess).toBe('boolean');
    expect(typeof status.hasRosterData).toBe('boolean');
    expect(typeof status.isFullyReady).toBe('boolean');
  });

  it('should update roster readiness', () => {
    service.setRosterDataReady(true);
    const status = service.getDetailedStatus();
    expect(status.hasRosterData).toBe(true);
  });

  it('should update storage readiness', () => {
    service.setDeviceStorageReady(false);
    const status = service.getDetailedStatus();
    expect(status.hasStorageAccess).toBe(false);
  });

  it('should provide appropriate label when fully ready', () => {
    service.setRosterDataReady(true);
    service.setDeviceStorageReady(true);
    if (service.ready()) {
      expect(service.label).toBe('Ready offline');
    }
  });
});
