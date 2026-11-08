#include <stdbool.h>
char *journal_probe(const char *path, bool mac, const char *pair, const char *command,
                    const char *input, char *(*rpc)(const char *));
void journal_probe_free(char *result);
