// 统一错误提示：把"一闪而过"的 toast 升级为可重试的 modal。
//
// 用法：
//   // 关键失败（查询/翻译/同步等用户期望能重试的操作）
//   showRetryError('查询失败', () => this.searchWord());
//
//   // 次要提示（输入校验、状态反馈）
//   showToast('已收藏');

/**
 * 弹模态框，附带「重试」按钮。
 * @param {string} message - 显示给用户的错误描述
 * @param {function} retryFn - 用户点击"重试"时执行的回调
 * @param {string} [title] - 弹框标题（默认"出错了"）
 */
function showRetryError(message, retryFn, title) {
  if (typeof retryFn !== 'function') {
    // 降级：没传 retry 就退化为 toast
    showToast(message);
    return;
  }
  wx.showModal({
    title: title || '出错了',
    content: message,
    confirmText: '重试',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        try {
          retryFn();
        } catch (e) {
          console.error('[showRetryError] retry callback threw:', e);
        }
      }
    }
  });
}

/**
 * 轻量提示（输入校验、状态反馈等不适合打断用户的场景）。
 */
function showToast(message, icon) {
  wx.showToast({
    title: message,
    icon: icon || 'none',
    duration: 2000
  });
}

module.exports = {
  showRetryError,
  showToast
};
