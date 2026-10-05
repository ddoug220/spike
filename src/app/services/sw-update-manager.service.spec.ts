import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { SwUpdateManagerService } from './sw-update-manager.service';
import { OfflineSyncService } from './offline-sync.service';

describe('SwUpdateManagerService', () => {
  let service: SwUpdateManagerService;
  let mockSwUpdate: jasmine.SpyObj<SwUpdate>;
  let mockOfflineSync: jasmine.SpyObj<OfflineSyncService>;
  let versionUpdatesSubject: Subject<VersionReadyEvent>;

  beforeEach(() => {
    versionUpdatesSubject = new Subject<VersionReadyEvent>();
    mockSwUpdate = jasmine.createSpyObj('SwUpdate', ['activateUpdate'], {
      isEnabled: true,
      versionUpdates: versionUpdatesSubject.asObservable(),
    });
    mockOfflineSync = jasmine.createSpyObj('OfflineSyncService', ['getActiveMatchId', 'getGame']);

    TestBed.configureTestingModule({
      providers: [
        SwUpdateManagerService,
        { provide: SwUpdate, useValue: mockSwUpdate },
        { provide: OfflineSyncService, useValue: mockOfflineSync },
      ],
    });
    service = TestBed.inject(SwUpdateManagerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should not mark update as pending initially', () => {
    expect(service.hasPendingUpdate()).toBe(false);
  });

  it('should mark update as pending when VERSION_READY event occurs', () => {
    versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    expect(service.hasPendingUpdate()).toBe(true);
  });

  it('should not activate update when live match is in progress', () => {
    mockOfflineSync.getActiveMatchId.and.returnValue('match-1');
    mockOfflineSync.getGame.and.returnValue({ id: 'match-1', status: 'live' } as any);

    versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    
    expect(service.hasPendingUpdate()).toBe(true);
    expect(mockSwUpdate.activateUpdate).not.toHaveBeenCalled();
  });

  it('should activate update immediately when no live match exists', (done) => {
    mockOfflineSync.getActiveMatchId.and.returnValue('match-1');
    mockOfflineSync.getGame.and.returnValue({ id: 'match-1', status: 'final' } as any);
    mockSwUpdate.activateUpdate.and.returnValue(Promise.resolve(true));

    const originalReload = document.location.reload;
    document.location.reload = jasmine.createSpy('reload') as any;

    versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);

    setTimeout(() => {
      expect(mockSwUpdate.activateUpdate).toHaveBeenCalled();
      document.location.reload = originalReload;
      done();
    }, 100);
  });

  it('should not activate update manually during live match', () => {
    mockOfflineSync.getActiveMatchId.and.returnValue('match-1');
    mockOfflineSync.getGame.and.returnValue({ id: 'match-1', status: 'live' } as any);

    versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    service.activateUpdate();

    expect(mockSwUpdate.activateUpdate).not.toHaveBeenCalled();
  });
});
