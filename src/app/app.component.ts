import { Component, Optional } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdateManagerService } from './services/sw-update-manager.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor(@Optional() _swUpdate: SwUpdateManagerService) {
    // Injecting SwUpdateManagerService ensures it's instantiated and monitoring updates
  }
}
