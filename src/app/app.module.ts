import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { CesiumudsdkDirective } from './cesiumudsdk.directive';

@NgModule({
  declarations: [
    AppComponent,
    CesiumudsdkDirective
  ],
  imports: [
    BrowserModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
