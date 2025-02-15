"use strict";

class ListPage {
	/**
	 * @param opts Options object.
	 * @param opts.dataSource Main JSON data url or function to fetch main data.
	 * @param [opts.dataSourceFluff] Fluff JSON data url or function to fetch fluff data.
	 * @param [opts.filters] Array of filters to use in the filter box. (Either `filters` and `filterSource` or
	 * `pageFilter` must be specified.)
	 * @param [opts.filterSource] Source filter. (Either `filters` and `filterSource` or
	 * `pageFilter` must be specified.)
	 * @param [opts.pageFilter] PageFilter implementation for this page. (Either `filters` and `filterSource` or
	 * `pageFilter` must be specified.)
	 * @param opts.listClass List class.
	 * @param opts.listOptions Other list options.
	 * @param opts.sublistClass Sublist class.
	 * @param opts.sublistOptions Other sublist options.
	 * @param opts.dataProps JSON data propert(y/ies).
	 * @param [opts.bookViewOptions] Book view options.
	 * @param [opts.printViewOptions] Print view options.
	 * @param [opts.tableViewOptions] Table view options.
	 * @param [opts.hasAudio] True if the entities have pronunciation audio.
	 * @param [opts.previewRenderFn] Function to render entities to be previewed in-line as part of the list.
	 */
	constructor (opts) {
		this._dataSource = opts.dataSource;
		this._dataSourcefluff = opts.dataSourceFluff;
		this._filters = opts.filters;
		this._filterSource = opts.filterSource;
		this._pageFilter = opts.pageFilter;
		this._listClass = opts.listClass;
		this._listOptions = opts.listOptions || {};
		this._sublistClass = opts.sublistClass;
		this._sublistOptions = opts.sublistOptions || {};
		this._dataProps = opts.dataProps;
		this._bookViewOptions = opts.bookViewOptions;
		this._printViewOptions = opts.printViewOptions;
		this._tableViewOptions = opts.tableViewOptions;
		this._previewRenderFn = opts.previewRenderFn;

		this._renderer = Renderer.get();
		this._list = null;
		this._listSub = null;
		this._filterBox = null;
		this._dataList = [];
		this._ixData = 0;
		this._bookView = null;
	}

	async pOnLoad () {
		await ExcludeUtil.pInitialise();
		const data = typeof this._dataSource === "string" ? await DataUtil.loadJSON(this._dataSource) : await this._dataSource();

		this._list = ListUtil.initList({
			$wrpList: $(`ul.list.${this._listClass}`),
			isPreviewable: this._previewRenderFn != null,
			syntax: this._listSyntax,
			...this._listOptions,
		});
		ListUtil.setOptions({primaryLists: [this._list]});
		SortUtil.initBtnSortHandlers($("#filtertools"), this._list);

		this._filterBox = await this._pageFilter.pInitFilterBox({
			$iptSearch: $(`#lst__search`),
			$wrpFormTop: $(`#filter-search-group`).title("Hotkey: f"),
			$btnReset: $(`#reset`),
		});

		const $outVisibleResults = $(`.lst__wrp-search-visible`);
		this._list.on("updated", () => $outVisibleResults.html(`${this._list.visibleItems.length}/${this._list.items.length}`));

		this._filterBox.on(FilterBox.EVNT_VALCHANGE, this.handleFilterChange.bind(this));

		this._listSub = ListUtil.initSublist({
			listClass: this._sublistClass,
			pGetSublistRow: this.getSublistItem.bind(this),
			...this._sublistOptions,
		});
		ListUtil.initGenericPinnable();
		SortUtil.initBtnSortHandlers($("#sublistsort"), this._listSub);

		this._addData(data);

		BrewUtil.bind({
			filterBox: this._filterBox,
			sourceFilter: this._pageFilter ? this._pageFilter.sourceFilter : this._filterSource,
			list: this._list,
			pHandleBrew: this._pHandleBrew.bind(this),
		});

		const homebrew = await BrewUtil.pAddBrewData();
		await this._pHandleBrew(homebrew);
		await BrewUtil.pAddLocalBrewData();

		BrewUtil.makeBrewButton("manage-brew");
		await ListUtil.pLoadState();
		RollerUtil.addListRollButton();
		ListUtil.addListShowHide();

		if (this._printViewOptions) {
			this._printView = new PrintModeView({
				hashKey: "printview",
				$openBtn: this._printViewOptions.$btnOpen,
				noneVisibleMsg: this._printViewOptions.noneVisibleMsg,
				pageTitle: this._printViewOptions.pageTitle || "Printer View",
				popTblGetNumShown: this._printViewOptions.popTblGetNumShown,
				hasPrintColumns: this._printViewOptions.hasPrintColumns,
			});
		}
		if (this._bookViewOptions) {
			const $openBtn = this._bookViewOptions.$btnOpen;
			const fnPopulate = this._bookViewOptions.fnPopulate;
			$openBtn.off("click").on("click", () => {
				const {$modalInner, doClose} = UiUtil.getShowModal({
					isUncappedHeight: true,
					isHeight100: true,
					isWidth100: true,
					isUncappedWidth: true,
				});
				const $wrpContent = $(`<div class="pf2-book stats bkv__content-wrp my-4"></div>`).appendTo($modalInner)
				fnPopulate($wrpContent);
				const $btnClose = $(`<button class="btn btn-danger btn-sm mt-auto mb-1" style="width: fit-content; align-self: center;">Close</button>`).click(() => doClose()).appendTo($modalInner);
			});
		}

		// bind hash-change functions for hist.js to use
		window.loadHash = this.doLoadHash.bind(this);
		window.loadSubHash = this.pDoLoadSubHash.bind(this);

		this._list.init();
		this._listSub.init();

		Hist.init(true);
		ExcludeUtil.checkShowAllExcluded(this._dataList, $(`#pagecontent`));
		window.dispatchEvent(new Event("toolsLoaded"));
	}

	async _pHandleBrew (homebrew) {
		try {
			this._addData(homebrew);
		} catch (e) {
			BrewUtil.pPurgeBrew(e);
		}
	}

	_addData (data) {
		if (!this._dataProps.some(prop => data[prop] && data[prop].length)) return;

		this._dataProps.forEach(prop => {
			if (!data[prop]) return;
			data[prop].forEach(it => it.__prop = prop);
			this._dataList.push(...data[prop]);
		});

		const len = this._dataList.length;
		for (; this._ixData < len; this._ixData++) {
			const it = this._dataList[this._ixData];
			const isExcluded = ExcludeUtil.isExcluded(UrlUtil.autoEncodeHash(it), it.__prop, it.source);
			const listItem = this.getListItem(it, this._ixData, isExcluded);
			if (this._previewRenderFn != null) this._doBindPreview(listItem);
			this._list.addItem(listItem);
		}

		this._list.update();
		this._filterBox.render();
		this.handleFilterChange();

		ListUtil.setOptions({
			itemList: this._dataList,
			primaryLists: [this._list],
		});
		ListUtil.bindPinButton();
		const $btnPop = ListUtil.getOrTabRightButton(`btn-popout`, `new-window`);
		Renderer.hover.bindPopoutButton($btnPop, this._dataList);
		UrlUtil.bindLinkExportButton(this._filterBox);
		ListUtil.bindOtherButtons({
			download: true,
			upload: true,
		});

		if (this._tableViewOptions) {
			ListUtil.bindShowTableButton(
				"btn-show-table",
				this._tableViewOptions.title,
				this._dataList,
				this._tableViewOptions.colTransforms,
				this._tableViewOptions.filter,
				this._tableViewOptions.sorter,
			);
		}
	}

	/** Requires a "[+]" button as the first list column, and the item to contain a second hidden display element. */
	_doBindPreview (listItem) {
		const btnToggleExpand = listItem.ele.firstElementChild.firstElementChild;
		const dispExpandedOuter = listItem.ele.lastElementChild;
		const dispExpandedInner = dispExpandedOuter.lastElementChild;

		dispExpandedOuter.addEventListener("click", evt => {
			evt.stopPropagation();
		});

		btnToggleExpand.addEventListener("click", evt => {
			evt.stopPropagation();
			evt.preventDefault();

			dispExpandedOuter.classList.toggle("ve-hidden");

			const isExpand = btnToggleExpand.innerHTML === `[+]`;
			if (isExpand) {
				btnToggleExpand.innerHTML = `[\u2012]`;
				$$`${this._previewRenderFn(this._dataList[listItem.ix])}`.appendTo(dispExpandedInner);
			} else {
				btnToggleExpand.innerHTML = `[+]`;
				dispExpandedInner.innerHTML = "";
			}
		});
	}

	get _listSyntax () {
		return {
			text: {
				help: `"text:<text>" to search within text.`,
				fn: (listItem, searchTerm) => {
					if (listItem.data._textCache == null) listItem.data._textCache = this._getSearchCache(this._dataList[listItem.ix]);
					return listItem.data._textCache && listItem.data._textCache.includes(searchTerm);
				},
			},
		}
	}

	// TODO(Future) the ideal solution to this is to render every entity to plain text (or failing that, Markdown) and
	//   indexing that text with e.g. elasticlunr.
	_getSearchCache (entity) {
		if (!entity.entries) return "";
		const ptrOut = {_: ""};
		this._getSearchCache_handleEntryProp(entity, "entries", ptrOut);
		return ptrOut._;
	}

	_getSearchCache_handleEntryProp (entity, prop, ptrOut) {
		if (!entity[prop]) return;
		ListPage._READONLY_WALKER.walk(
			entity[prop],
			{
				string: (str) => this._getSearchCache_handleString(ptrOut, str),
			},
		);
	}

	_getSearchCache_handleString (ptrOut, str) {
		ptrOut._ += `${Renderer.stripTags(str).toLowerCase()} -- `;
	}

	getListItem () { throw new Error(`Unimplemented!`); }
	handleFilterChange () { throw new Error(`Unimplemented!`); }
	getSublistItem () { throw new Error(`Unimplemented!`); }
	doLoadHash () { throw new Error(`Unimplemented!`); }
	pDoLoadSubHash () { throw new Error(`Unimplemented!`); }
}
ListPage._READONLY_WALKER = MiscUtil.getWalker({
	keyBlacklist: new Set(["type", "colStyles", "style"]),
	isNoModification: true,
});
