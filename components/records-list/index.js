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

    onClearAll() {
      this.triggerEvent('clearall');
    },

    formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
});