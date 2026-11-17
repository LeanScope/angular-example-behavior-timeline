import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { provideLeanScope } from './leanscope/leanscope.config';
import { APP_ENV } from './features/app-env';
import { BrandService } from './design-system/brand.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideLeanScope(environment.leanscope),
    { provide: APP_ENV, useValue: environment.app },
    provideAppInitializer(() => inject(BrandService).init()),
  ],
};
