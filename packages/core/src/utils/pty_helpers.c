#include <fcntl.h>

/* Set a file descriptor to non-blocking mode. Returns 0 on success, -1 on error. */
int set_fd_nonblock(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}
