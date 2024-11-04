/*
*  Power BI Visual CLI
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved.
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*
*  The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
*
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/
"use strict";

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import FilterAction = powerbi.FilterAction;
import ISQExpr = powerbi.data.ISQExpr;

import { IAdvancedFilter, AdvancedFilter, IFilterTarget } from "powerbi-models";

import { Selection as d3Selection, select as d3Select } from "d3-selection";

import { TextFilterSettingsModel } from "./settings";

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";

const pxToPt = 0.75,
  fontPxAdjSml = 20,
  fontPxAdjStd = 24,
  fontPxAdjLrg = 26;


export class Visual implements IVisual {

  private target: HTMLElement;
  private searchUi: d3Selection<HTMLDivElement, any, any, any>;
  private searchBox: d3Selection<HTMLInputElement, any, any, any>;
  private searchButton: d3Selection<HTMLButtonElement, any, any, any>;
  private clearButton: d3Selection<HTMLButtonElement, any, any, any>;
  private column: powerbi.DataViewMetadataColumn;
  private host: powerbi.extensibility.visual.IVisualHost;
  private events: IVisualEventService;
  private formattingSettingsService: FormattingSettingsService;
  private formattingSettings: TextFilterSettingsModel;
  private localizationManager: ILocalizationManager;

  constructor(options: VisualConstructorOptions) {
    this.events = options.host.eventService;
    this.target = options.element;
    this.localizationManager = options.host.createLocalizationManager();

    this.searchUi = d3Select(this.target)
      .append("div")
      .classed("text-filter-search", true);
    this.searchBox = this.searchUi
      .append("input")
      .attr('placeholder', this.localizationManager.getDisplayName("Visual_Input_Placeholder"))
      .attr("aria-label", this.localizationManager.getDisplayName("Visual_Input_Placeholder"))
      .attr("type", "text")
      .attr("name", "search-field")
      .attr("autofocus", true)
      .attr("tabindex", 0)
      .classed("accessibility-compliant", true)
      .classed("border-on-focus", true);
    this.searchButton = this.searchUi
      .append("button")
      .classed("c-glyph search-button", true)
      .attr("name", "search-button")
      .attr("tabindex", 0)
      .classed("outline-on-focus", true);
    this.searchButton
      .append("span")
      .classed("x-screen-reader", true)
      .text("Search");
    this.clearButton = this.searchUi
      .append("button")
      .classed("c-glyph clear-button", true)
      .attr("name", "clear-button")
      .attr("tabindex", 0)
      .classed("border-on-focus", true);
    this.clearButton
      .append("span")
      .classed("x-screen-reader", true)
      .text("Clear");


    this.searchBox.on("keydown", (event) => {
      if (event.key === "Enter") {
        this.performSearch(this.searchBox.property("value"));
      }
    });

    // these click handlers also handle "Enter" key press with keyboard navigation
    this.searchButton
      .on("click", () => this.performSearch(this.searchBox.property("value")));
    this.clearButton
      .on("click", () => this.performSearch(""));

      d3Select(this.target)
      .on("contextmenu", (event) => {
        const
          mouseEvent: MouseEvent = event,
          selectionManager = options.host.createSelectionManager();
        selectionManager.showContextMenu({}, {
          x: mouseEvent.clientX,
          y: mouseEvent.clientY
        });
        mouseEvent.preventDefault();
      });

    this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);

    this.host = options.host;
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    // removes border color
    if (this.formattingSettings?.textBox.enableBorder.value === false) {
      this.formattingSettings.removeBorderColor();
    }
    const model = this.formattingSettingsService.buildFormattingModel(this.formattingSettings);

    return model;
  }

  public update(options: VisualUpdateOptions) {
    this.events.renderingStarted(options);
    this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(TextFilterSettingsModel, options.dataViews[0]);
    const metadata = options.dataViews && options.dataViews[0] && options.dataViews[0].metadata;
    const newColumn = metadata && metadata.columns && metadata.columns[0];
    let searchText = "";
    this.updateUiSizing();

    // We had a column, but now it is empty, or it has changed.
    if (options.dataViews && options.dataViews.length > 0 && this.column && (!newColumn || this.column.queryName !== newColumn.queryName)) {
      this.performSearch("");

      // Well, it hasn't changed, then lets try to load the existing search text.
    } else if (options?.jsonFilters?.length > 0) {
      searchText = `${(<IAdvancedFilter[]>options.jsonFilters).map((f) => f.conditions.map((c) => c.value)).join(" ")}`;
    }

    this.searchBox.property("value", searchText);
    this.column = newColumn;

    this.events.renderingFinished(options);

  }

  /**
   * Ensures that the UI is sized according to the specified properties (or defaults, if not overridden).
   */
  private updateUiSizing() {
    const
      textBox = this.formattingSettings?.textBox,
      fontSize = textBox.font.fontSize.value,
      fontScaleSml = Math.floor((fontSize / pxToPt) + fontPxAdjSml),
      fontScaleStd = Math.floor((fontSize / pxToPt) + fontPxAdjStd),
      fontScaleLrg = Math.floor((fontSize / pxToPt) + fontPxAdjLrg);
    this.searchUi
      .style('height', `${fontScaleStd}px`)
      .style('font-size', `${fontSize}pt`)
      .style('font-family', textBox.font.fontFamily.value);
    this.searchBox
      .style('width', `calc(100% - ${fontScaleStd}px)`)
      .style('padding-right', `${fontScaleStd}px`)
      .style('border-style', textBox.enableBorder.value && 'solid' || 'none')
      .style('border-color', textBox.borderColor.value.value);
    this.searchButton
      .style('right', `${fontScaleLrg}px`)
      .style('width', `${fontScaleSml}px`)
      .style('height', `${fontScaleSml}px`)
      .style('font-size', `${fontSize}pt`);
    this.clearButton
      .style('width', `${fontScaleStd}px`)
      .style('height', `${fontScaleStd}px`);
  }

  /** 
   * Perfom search/filtering in a column
   * @param {string} text - text to filter on
   */
  public performSearch(text: string) {
    if (this.column) {
      let target: IFilterTarget;

      if (this.isValidExpr(this.column.expr)) {
        const columnName: string = this.column.expr.ref;
        const tableName: string = this.column.expr.source.entity;
        target = { table: tableName, column: columnName };
      } else {
        const dotIndex = this.column.queryName.indexOf(".");
        target = {
          table: this.column.queryName.slice(0, dotIndex),
          column: this.column.queryName.slice(dotIndex + 1)
        };
      }


      let filter: any = null;
      let action = FilterAction.remove;
      const isBlank = ((text || "") + "").match(/^\s*$/);
      if (!isBlank) {
        filter = new AdvancedFilter(
          target,
          "And",
          {
            operator: "Contains",
            value: text
          }
        );
        action = FilterAction.merge;
      }
      this.host.applyJsonFilter(filter, "general", "filter", action);
    }
    this.searchBox.property("value", text);
  }

  private isValidExpr(expr: ISQExpr | undefined): expr is { ref: string, source: { entity: string } } {
    if (expr != null &&
      'ref' in expr && typeof expr.ref === 'string' &&
      'source' in expr && typeof expr.source === 'object' &&
      'entity' in expr.source && typeof expr.source.entity === 'string'
    ) {
      return true;
    }

    return false;
  }
}