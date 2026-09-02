// components/records-list/index.js
Component({
  properties: {
    list: {
      type: Array,
      value: []
    },
    titleField: {
      type: String,
      value: 'word'
    },
    subtitleField: {
      type: String,
      value: 'content'
    },
    showTime: {
      type: Boolean,
      value: true
    },
    emptyText: {
      type: String,
      value: '暂无记录'
    },
    // 新增可选属性（不传则不显示，对 history/collections 零侵入）：
    // extraField: 项里要显示的额外标记字段名（如 'fromCache'），值为字符串才渲染
    extraField: {
      type: String,
      value: ''
    },
    // actionLabel: 右侧操作按钮文案（如 '重译'），空则不显示
    actionLabel: {
      type: String,
      value: ''
    },
    // actionEvent: 操作按钮触发的事件名，默认 'action'
    actionEvent: {
      type: String,
      value: 'action'
    }
  },

  methods: {
    onItemTap(e) {
      const index = e.currentTarget.dataset.index;
      this.triggerEvent('itemtap', {
        item: this.data.list[index],
        index
      });
    },

    onItemDelete(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      this.triggerEvent('itemdelete', { item, index });
    },

    onItemAction(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      this.triggerEvent(this.data.actionEvent || 'action', { item, index });
    },

    onClearAll() {
      this.triggerEvent('clearall');
    }
  }
});
