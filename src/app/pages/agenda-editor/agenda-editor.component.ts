import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgendaStateService } from '../../services/agenda-state.service';
import { DocxService } from '../../services/docx.service';
import { MeetingFormComponent } from '../../components/meeting-form/meeting-form.component';
import { AgendaItemsComponent } from '../../components/agenda-items/agenda-items.component';
import { SpeakersFormComponent } from '../../components/speakers-form/speakers-form.component';
import { CommitteeFormComponent } from '../../components/committee-form/committee-form.component';
import { AgendaPreviewComponent } from '../../components/agenda-preview/agenda-preview.component';

@Component({
  selector: 'app-agenda-editor',
  standalone: true,
  imports: [
    RouterLink,
    MeetingFormComponent,
    AgendaItemsComponent,
    SpeakersFormComponent,
    CommitteeFormComponent,
    AgendaPreviewComponent,
  ],
  templateUrl: './agenda-editor.component.html',
})
export class AgendaEditorComponent {
  readonly state = inject(AgendaStateService);
  private readonly docxService = inject(DocxService);

  docxBusy = false;

  async generateDocx() {
    this.docxBusy = true;
    try {
      const snapshot = this.state.getSnapshot();
      await this.docxService.generate(snapshot, this.state.agendaFileName());
    } catch (err) {
      alert('DOCX generation failed:\n' + (err as Error).message);
      console.error(err);
    } finally {
      this.docxBusy = false;
    }
  }

  saveJSON() {
    this.state.saveJSON();
  }

  loadJSON() {
    document.getElementById('jf')?.click();
  }

  onImportJSON(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target!.result as string);
        this.state.loadSnapshot(data);
      } catch (err) {
        alert('Error loading JSON: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  printAgenda() {
    document.title = this.state.agendaFileName();
    window.print();
  }
}
